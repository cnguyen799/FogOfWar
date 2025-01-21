const player = document.getElementById('player');
const minimapPlayer = document.getElementById('minimap-player');
const gameArea = document.getElementById('gameArea');
const viewport = document.getElementById('viewport');
const minimapViewport = document.getElementById('minimap-viewport');
const ghostBuilding = document.getElementById('ghost-building');
const buildRange = document.getElementById('build-range');
const fogContainer = document.getElementById('fog-container');
const minimapFogContainer = document.getElementById('minimap-fog-container');
const buildingMenu = document.getElementById('building-menu');
const buildingOptions = Array.from(document.querySelectorAll('.building-option'));
const enemiesContainer = document.getElementById('enemies-container');
const minimapEnemiesContainer = document.getElementById('minimap-enemies-container');

// Initialize building menu
if (buildingOptions.length === 0) {
    console.error('Building options not found!');
} else {
    console.log('Found', buildingOptions.length, 'building options');
    buildingOptions.forEach(option => {
        console.log('Building option:', option.dataset.key);
    });
}

const GAME_WIDTH = 4000;
const GAME_HEIGHT = 4000;
const GRID_SIZE = 50;
const MINIMAP_SIZE = 200;
const BUILD_RANGE = 200;
const CHUNK_SIZE = 100;
const VISION_RANGE = 250;
const ENEMY_SPEED = 2;
const SPAWN_INTERVAL = 3000;
const MAX_SPAWNERS = 4;
const MIN_SPAWNER_DISTANCE = 800;
const MAX_ENEMIES_PER_SPAWNER = 3;
const ENEMY_POOL_SIZE = 50; // Pre-create 50 enemies
const VIEWPORT_BUFFER = 200; // Extra area around viewport to keep enemies active

// Game state
const chunks = new Map();
const minimapChunks = new Map();
const enemies = [];
const placedBuildings = [];
const spawners = [];
let enemyPool = [];
let pendingUpdates = new Map(); // Store position updates for batch processing

class Quadtree {
    constructor(bounds, maxObjects = 10, maxLevels = 4, level = 0) {
        this.bounds = bounds;
        this.maxObjects = maxObjects;
        this.maxLevels = maxLevels;
        this.level = level;
        this.objects = [];
        this.nodes = [];
    }

    clear() {
        this.objects = [];
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i]) {
                this.nodes[i].clear();
            }
        }
        this.nodes = [];
    }

    split() {
        const subWidth = this.bounds.width / 2;
        const subHeight = this.bounds.height / 2;
        const x = this.bounds.x;
        const y = this.bounds.y;

        this.nodes[0] = new Quadtree({
            x: x + subWidth,
            y: y,
            width: subWidth,
            height: subHeight
        }, this.maxObjects, this.maxLevels, this.level + 1);

        this.nodes[1] = new Quadtree({
            x: x,
            y: y,
            width: subWidth,
            height: subHeight
        }, this.maxObjects, this.maxLevels, this.level + 1);

        this.nodes[2] = new Quadtree({
            x: x,
            y: y + subHeight,
            width: subWidth,
            height: subHeight
        }, this.maxObjects, this.maxLevels, this.level + 1);

        this.nodes[3] = new Quadtree({
            x: x + subWidth,
            y: y + subHeight,
            width: subWidth,
            height: subHeight
        }, this.maxObjects, this.maxLevels, this.level + 1);
    }

    getIndex(rect) {
        let index = -1;
        const verticalMidpoint = this.bounds.x + (this.bounds.width / 2);
        const horizontalMidpoint = this.bounds.y + (this.bounds.height / 2);

        const topQuadrant = (rect.y < horizontalMidpoint && rect.y + rect.height < horizontalMidpoint);
        const bottomQuadrant = (rect.y > horizontalMidpoint);

        if (rect.x < verticalMidpoint && rect.x + rect.width < verticalMidpoint) {
            if (topQuadrant) {
                index = 1;
            }
            else if (bottomQuadrant) {
                index = 2;
            }
        }
        else if (rect.x > verticalMidpoint) {
            if (topQuadrant) {
                index = 0;
            }
            else if (bottomQuadrant) {
                index = 3;
            }
        }

        return index;
    }

    insert(rect) {
        if (this.nodes.length) {
            const index = this.getIndex(rect);

            if (index !== -1) {
                this.nodes[index].insert(rect);
                return;
            }
        }

        this.objects.push(rect);

        if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
            if (this.nodes.length === 0) {
                this.split();
            }

            let i = 0;
            while (i < this.objects.length) {
                const index = this.getIndex(this.objects[i]);
                if (index !== -1) {
                    this.nodes[index].insert(this.objects.splice(i, 1)[0]);
                }
                else {
                    i++;
                }
            }
        }
    }

    retrieve(rect) {
        let returnObjects = [];
        const index = this.getIndex(rect);

        if (this.nodes.length) {
            if (index !== -1) {
                returnObjects = returnObjects.concat(this.nodes[index].retrieve(rect));
            }
            else {
                for (let i = 0; i < this.nodes.length; i++) {
                    returnObjects = returnObjects.concat(this.nodes[i].retrieve(rect));
                }
            }
        }

        returnObjects = returnObjects.concat(this.objects);

        return returnObjects;
    }
}

// Initialize quadtree
const quadtree = new Quadtree({
    x: 0,
    y: 0,
    width: GAME_WIDTH,
    height: GAME_HEIGHT
});

function initializeEnemyPool() {
    const container = document.getElementById('enemies-container');
    const minimapContainer = document.getElementById('minimap-enemies-container');

    for (let i = 0; i < ENEMY_POOL_SIZE; i++) {
        // Create main enemy element
        const enemy = document.createElement('div');
        enemy.className = 'enemy';
        enemy.style.display = 'none';
        enemy.style.transform = 'translate3d(0px, 0px, 0)';
        enemy.style.willChange = 'transform';
        container.appendChild(enemy);

        // Create minimap element
        const minimapEnemy = document.createElement('div');
        minimapEnemy.className = 'minimap-enemy';
        minimapEnemy.style.display = 'none';
        minimapEnemy.style.transform = 'translate3d(0px, 0px, 0)';
        minimapEnemy.style.willChange = 'transform';
        minimapContainer.appendChild(minimapEnemy);

        // Store in pool
        enemyPool.push({
            element: enemy,
            minimapElement: minimapEnemy,
            active: false,
            x: 0,
            y: 0,
            spawner: null,
            lastInViewport: false
        });
    }
}

function getEnemyFromPool(spawner) {
    const enemy = enemyPool.find(e => !e.active);
    if (!enemy) return null;

    // Initialize enemy position
    const spawnRadius = 100;
    const angle = Math.random() * Math.PI * 2;
    const spawnX = spawner.x + 50 + Math.cos(angle) * spawnRadius;
    const spawnY = spawner.y + 50 + Math.sin(angle) * spawnRadius;

    enemy.active = true;
    enemy.x = spawnX;
    enemy.y = spawnY;
    enemy.spawner = spawner;
    enemy.element.style.display = 'block';
    enemy.minimapElement.style.display = 'block';
    updateEntityPosition(enemy);

    return enemy;
}

function updateEntityPosition(entity) {
    // Add to pending updates instead of updating DOM directly
    pendingUpdates.set(entity, {
        x: entity.x,
        y: entity.y
    });
}

function applyPendingUpdates() {
    pendingUpdates.forEach((pos, entity) => {
        // Update main element
        entity.element.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
        
        // Update minimap element
        const minimapX = (pos.x / GAME_WIDTH) * MINIMAP_SIZE;
        const minimapY = (pos.y / GAME_HEIGHT) * MINIMAP_SIZE;
        entity.minimapElement.style.transform = `translate3d(${minimapX}px, ${minimapY}px, 0)`;
    });
    pendingUpdates.clear();
}

function isInViewport(x, y) {
    return x >= cameraX - VIEWPORT_BUFFER &&
           x <= cameraX + window.innerWidth + VIEWPORT_BUFFER &&
           y >= cameraY - VIEWPORT_BUFFER &&
           y <= cameraY + window.innerHeight + VIEWPORT_BUFFER;
}

function spawnEnemy(spawner) {
    if (spawner.activeEnemies >= MAX_ENEMIES_PER_SPAWNER) return;
    
    const enemy = getEnemyFromPool(spawner);
    if (!enemy) return;  // No available enemies in pool
    
    spawner.activeEnemies++;
    updateSpawnerCounter(spawner);
    enemies.push(enemy);
}

function removeEnemy(enemy) {
    enemy.active = false;
    enemy.element.style.display = 'none';
    enemy.minimapElement.style.display = 'none';
    enemy.spawner.activeEnemies--;
    updateSpawnerCounter(enemy.spawner);
    
    const index = enemies.indexOf(enemy);
    if (index > -1) {
        enemies.splice(index, 1);
    }
}

function updateEnemies() {
    // Clear and rebuild quadtree
    quadtree.clear();
    enemies.forEach(enemy => {
        quadtree.insert({
            x: enemy.x,
            y: enemy.y,
            width: 30,
            height: 30,
            enemy: enemy
        });
    });

    // Update enemy positions
    enemies.forEach(enemy => {
        // Always update position
        const dx = x - enemy.x;
        const dy = y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            enemy.x += (dx / distance) * ENEMY_SPEED;
            enemy.y += (dy / distance) * ENEMY_SPEED;
            
            // Only update DOM if in viewport
            if (isInViewport(enemy.x, enemy.y)) {
                updateEntityPosition(enemy);
            } else {
                // If enemy just left viewport, update one last time
                if (enemy.lastInViewport) {
                    updateEntityPosition(enemy);
                    enemy.lastInViewport = false;
                }
            }
        }
        
        // Track viewport status
        if (isInViewport(enemy.x, enemy.y)) {
            enemy.lastInViewport = true;
        }
    });
}

function updateEnemyVisibility() {
    enemies.forEach(enemy => {
        // Get the chunk coordinates for this enemy
        const enemyChunkX = Math.floor(enemy.x / CHUNK_SIZE);
        const enemyChunkY = Math.floor(enemy.y / CHUNK_SIZE);
        const chunkKey = `${enemyChunkX},${enemyChunkY}`;
        const chunk = chunks.get(chunkKey);
        
        // Check if the chunk is visible
        if (chunk && chunk.classList.contains('visible')) {
            enemy.element.style.display = 'block'; // Show enemy in the game world
            enemy.minimapElement.style.display = 'block'; // Show enemy on the minimap
        } else {
            enemy.element.style.display = 'none'; // Hide enemy in the game world
            enemy.minimapElement.style.display = 'none'; // Hide enemy on the minimap
        }
    });
}

function createSpawner(x, y) {
    const spawner = document.createElement('div');
    spawner.className = 'spawner';
    spawner.style.position = 'absolute';
    spawner.style.left = `${x}px`;
    spawner.style.top = `${y}px`;
    spawner.style.display = 'none'; // Start hidden
    document.getElementById('gameArea').appendChild(spawner);

    // Create enemy counter
    const counter = document.createElement('div');
    counter.className = 'spawner-counter';
    counter.textContent = '0/' + MAX_ENEMIES_PER_SPAWNER;
    spawner.appendChild(counter);
    
    // Create minimap indicator
    const minimapSpawner = document.createElement('div');
    minimapSpawner.className = 'minimap-spawner';
    minimapSpawner.style.left = (x / GAME_WIDTH) * MINIMAP_SIZE + 'px';
    minimapSpawner.style.top = (y / GAME_HEIGHT) * MINIMAP_SIZE + 'px';
    minimapSpawner.style.display = 'none'; // Start hidden
    document.getElementById('minimap').appendChild(minimapSpawner);
    
    // Store spawner with its dimensions and minimap element
    const spawnerObj = {
        x: x,
        y: y,
        width: 100,
        height: 100,
        element: spawner,
        minimapElement: minimapSpawner,
        counter: counter,
        type: 'spawner',
        activeEnemies: 0,
        discovered: false // Track discovery state
    };
    
    spawners.push(spawnerObj);
    
    // Start spawning enemies
    setInterval(() => {
        if (spawnerObj.activeEnemies < MAX_ENEMIES_PER_SPAWNER) {
            spawnEnemy(spawnerObj);
        }
    }, SPAWN_INTERVAL);
    
    return spawnerObj;
}

function updateSpawnerCounter(spawner) {
    spawner.counter.textContent = spawner.activeEnemies + '/' + MAX_ENEMIES_PER_SPAWNER;
}

function updateSpawnerVisibility() {
    spawners.forEach(spawner => {
        // Get the chunk coordinates for this spawner
        const spawnerChunkX = Math.floor(spawner.x / CHUNK_SIZE);
        const spawnerChunkY = Math.floor(spawner.y / CHUNK_SIZE);
        const chunkKey = `${spawnerChunkX},${spawnerChunkY}`;
        const chunk = chunks.get(chunkKey);
        
        if (chunk && chunk.classList.contains('visible') && !spawner.discovered) {
            // Spawner's chunk is visible, reveal it permanently
            spawner.discovered = true;
            spawner.element.style.display = 'block';
            spawner.minimapElement.style.display = 'block';
        }
    });
}

function initializeSpawners() {
    const centerX = GAME_WIDTH / 2;
    const centerY = GAME_HEIGHT / 2;
    
    for (let i = 0; i < MAX_SPAWNERS; i++) {
        let validPosition = false;
        let attempts = 0;
        let spawnX, spawnY;
        
        // Try to find a valid position
        while (!validPosition && attempts < 100) {
            // Generate random position
            spawnX = Math.random() * (GAME_WIDTH - 200) + 100; // Keep away from edges
            spawnY = Math.random() * (GAME_HEIGHT - 200) + 100;
            
            // Check distance from player start position (center)
            const distToCenter = Math.sqrt(
                Math.pow(spawnX - centerX, 2) + 
                Math.pow(spawnY - centerY, 2)
            );
            
            // Check distance from other spawners
            const tooCloseToOthers = spawners.some(spawner => {
                const dist = Math.sqrt(
                    Math.pow(spawnX - spawner.x, 2) + 
                    Math.pow(spawnY - spawner.y, 2)
                );
                return dist < MIN_SPAWNER_DISTANCE;
            });
            
            if (distToCenter >= MIN_SPAWNER_DISTANCE && !tooCloseToOthers) {
                validPosition = true;
            }
            
            attempts++;
        }
        
        if (validPosition) {
            createSpawner(spawnX, spawnY);
        }
    }
}

function initializeFog() {
    const numChunksX = Math.ceil(GAME_WIDTH / CHUNK_SIZE);
    const numChunksY = Math.ceil(GAME_HEIGHT / CHUNK_SIZE);
    
    for (let cy = 0; cy < numChunksY; cy++) {
        for (let cx = 0; cx < numChunksX; cx++) {
            const chunk = document.createElement('div');
            chunk.className = 'fog-chunk';
            chunk.style.left = (cx * CHUNK_SIZE) + 'px';
            chunk.style.top = (cy * CHUNK_SIZE) + 'px';
            fogContainer.appendChild(chunk);
            chunks.set(`${cx},${cy}`, chunk);
        }
    }
}

function initializeMinimapFog() {
    const chunkSize = MINIMAP_SIZE / (GAME_WIDTH / CHUNK_SIZE); // Scale chunks to minimap size
    const numChunksX = Math.ceil(GAME_WIDTH / CHUNK_SIZE);
    const numChunksY = Math.ceil(GAME_HEIGHT / CHUNK_SIZE);
    
    for (let cy = 0; cy < numChunksY; cy++) {
        for (let cx = 0; cx < numChunksX; cx++) {
            const chunk = document.createElement('div');
            chunk.className = 'minimap-fog-chunk';
            chunk.style.left = (cx * chunkSize) + 'px';
            chunk.style.top = (cy * chunkSize) + 'px';
            chunk.style.width = chunkSize + 'px';
            chunk.style.height = chunkSize + 'px';
            minimapFogContainer.appendChild(chunk);
            minimapChunks.set(`${cx},${cy}`, chunk);
        }
    }
}

function updateFogOfWar() {
    // Calculate player center position and chunk
    const playerCenterX = x + 25;
    const playerCenterY = y + 25;
    const playerChunkX = Math.floor(playerCenterX / CHUNK_SIZE);
    const playerChunkY = Math.floor(playerCenterY / CHUNK_SIZE);
    
    // Calculate viewport chunks
    const viewportStartX = Math.floor(cameraX / CHUNK_SIZE);
    const viewportEndX = Math.ceil((cameraX + window.innerWidth) / CHUNK_SIZE);
    const viewportStartY = Math.floor(cameraY / CHUNK_SIZE);
    const viewportEndY = Math.ceil((cameraY + window.innerHeight) / CHUNK_SIZE);
    
    // Calculate vision radius in chunks
    const chunkRadius = 3;   // Adjusted for new chunk size to maintain similar vision range
    
    // Reset chunks that were visible but aren't anymore
    chunks.forEach((chunk, key) => {
        const [cx, cy] = key.split(',').map(Number);
        
        // Check if chunk is in viewport
        const inViewport = cx >= viewportStartX && cx <= viewportEndX && 
                         cy >= viewportStartY && cy <= viewportEndY;
        
        // Check if chunk is in player vision range
        const inPlayerVision = Math.abs(cx - playerChunkX) <= chunkRadius && 
                             Math.abs(cy - playerChunkY) <= chunkRadius;
        
        // Check if chunk is in building vision
        let inBuildingVision = false;
        for (const building of placedBuildings) {
            const buildingChunkX = Math.floor((building.x + 50) / CHUNK_SIZE);
            const buildingChunkY = Math.floor((building.y + 50) / CHUNK_SIZE);
            if (Math.abs(cx - buildingChunkX) <= 2 && Math.abs(cy - buildingChunkY) <= 2) {
                inBuildingVision = true;
                break;
            }
        }
        
        // Update main fog visibility (based on viewport)
        const shouldBeVisible = inPlayerVision || (inViewport && inBuildingVision);
        const isVisible = chunk.classList.contains('visible');
        
        if (shouldBeVisible !== isVisible) {
            if (shouldBeVisible) {
                chunk.classList.add('visible');
                chunk.classList.add('explored');
            } else {
                chunk.classList.remove('visible');
                if (!chunk.classList.contains('explored')) {
                    chunk.classList.add('explored');
                }
            }
        }
        
        // Update minimap chunk (buildings always provide vision on minimap)
        const minimapChunk = minimapChunks.get(key);
        if (minimapChunk) {
            minimapChunk.className = 'minimap-fog-chunk';
            
            // For minimap, buildings always provide vision regardless of viewport
            const minimapVisible = inPlayerVision || inBuildingVision;
            
            if (chunk.classList.contains('explored') || minimapVisible) {
                minimapChunk.classList.add('explored');
            }
            if (minimapVisible) {
                minimapChunk.classList.add('visible');
            }
        }
    });
    
    // Update spawner visibility after fog update
    updateSpawnerVisibility();
    // Update enemy visibility after fog update
    updateEnemyVisibility();
}

function updateMinimapFog() {
    // Reset all minimap chunks to match main fog chunks
    chunks.forEach((mainChunk, key) => {
        const minimapChunk = minimapChunks.get(key);
        if (minimapChunk) {
            minimapChunk.className = 'minimap-fog-chunk';
            if (mainChunk.classList.contains('explored')) {
                minimapChunk.classList.add('explored');
            }
            if (mainChunk.classList.contains('visible')) {
                minimapChunk.classList.add('visible');
            }
        }
    });
}

function scheduleFogUpdate() {
    if (!fogUpdatePending) {
        fogUpdatePending = true;
        requestAnimationFrame(() => {
            updateFogOfWar();
            fogUpdatePending = false;
        });
    }
}

let fogUpdatePending = false;
let lastPlayerChunkX = null;
let lastPlayerChunkY = null;

let x = GAME_WIDTH / 2;
let y = GAME_HEIGHT / 2;
let cameraX = x - window.innerWidth / 2;
let cameraY = y - window.innerHeight / 2;
const baseSpeed = 5;
let speed = baseSpeed;
const keys = {
    w: false,
    s: false,
    a: false,
    d: false,
    space: false,
    shift: false
};

// Add camera follow state
let cameraFollowEnabled = false;

// Building system
let selectedBuilding = null;
let mouseX = 0;
let mouseY = 0;

function checkBuildingCollision(x, y, width = 100, height = 100) {
    // Check if the new building overlaps with any existing building
    return placedBuildings.some(building => {
        return !(x + width <= building.x ||
                x >= building.x + building.width ||
                y + height <= building.y ||
                y >= building.y + building.height);
    });
}

function updateGhostBuilding() {
    if (!selectedBuilding) {
        ghostBuilding.style.display = 'none';
        return;
    }

    // Calculate grid-snapped position
    const gridX = Math.floor((mouseX + cameraX) / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.floor((mouseY + cameraY) / GRID_SIZE) * GRID_SIZE;

    // Check if position is valid (within build range)
    const distanceToPlayer = Math.max(
        Math.abs(gridX - x),
        Math.abs(gridY - y)
    );

    const isInRange = distanceToPlayer <= BUILD_RANGE;
    const hasCollision = checkBuildingCollision(gridX, gridY);
    const isValid = isInRange && !hasCollision;

    // Update ghost building position and style
    ghostBuilding.style.display = 'block';
    ghostBuilding.style.left = gridX + 'px';
    ghostBuilding.style.top = gridY + 'px';
    ghostBuilding.classList.toggle('invalid', !isValid);

    return { gridX, gridY, isValid };
}

function placeBuilding(x, y) {
    // Check for collisions before placing
    if (checkBuildingCollision(x, y)) {
        return false;
    }

    const building = document.createElement('div');
    building.className = 'building';
    building.style.position = 'absolute';
    building.style.left = `${x}px`;
    building.style.top = `${y}px`;
    building.style.opacity = 0; // Start with low opacity
    document.getElementById('gameArea').appendChild(building);

    // Gradually build the structure over time
    let progress = 0;
    const interval = setInterval(() => {
        progress += 100; // Update progress
        building.style.opacity = progress / 1000; // Fade in effect from 0 to 1
        if (progress >= 1000) {
            clearInterval(interval);
        }
    }, 200); // Adjust the interval timing for gradual building effect

    // Create minimap indicator for the building
    const minimapBuilding = document.createElement('div');
    minimapBuilding.className = 'minimap-building';
    minimapBuilding.style.left = (x / GAME_WIDTH) * MINIMAP_SIZE + 'px';
    minimapBuilding.style.top = (y / GAME_HEIGHT) * MINIMAP_SIZE + 'px';
    document.getElementById('minimap').appendChild(minimapBuilding);
    
    // Store building with its dimensions and minimap element
    placedBuildings.push({ 
        x, 
        y, 
        width: 100, 
        height: 100,
        element: building,
        minimapElement: minimapBuilding
    });
    
    return true;
}

function updatePosition() {
    player.style.left = x + 'px';
    player.style.top = y + 'px';
    
    const minimapX = (x / GAME_WIDTH) * MINIMAP_SIZE;
    const minimapY = (y / GAME_HEIGHT) * MINIMAP_SIZE;
    minimapPlayer.style.left = minimapX + 'px';
    minimapPlayer.style.top = minimapY + 'px';

    // Always update fog when position changes to ensure minimap stays current
    scheduleFogUpdate();
}

function centerCamera() {
    cameraX = x - window.innerWidth / 2;
    cameraY = y - window.innerHeight / 2;
    cameraX = Math.max(0, Math.min(cameraX, GAME_WIDTH - window.innerWidth));
    cameraY = Math.max(0, Math.min(cameraY, GAME_HEIGHT - window.innerHeight));
}

function updateCamera() {
    // Center camera if space is held OR camera follow is enabled
    if (keys.space || cameraFollowEnabled) {
        centerCamera();
    }
    
    gameArea.style.transform = `translate(${-cameraX}px, ${-cameraY}px)`;
    
    const viewportWidth = (window.innerWidth / GAME_WIDTH) * MINIMAP_SIZE;
    const viewportHeight = (window.innerHeight / GAME_HEIGHT) * MINIMAP_SIZE;
    const viewportX = (cameraX / GAME_WIDTH) * MINIMAP_SIZE;
    const viewportY = (cameraY / GAME_HEIGHT) * MINIMAP_SIZE;
    
    minimapViewport.style.width = viewportWidth + 'px';
    minimapViewport.style.height = viewportHeight + 'px';
    minimapViewport.style.left = viewportX + 'px';
    minimapViewport.style.top = viewportY + 'px';
}

// Edge scrolling functionality
const cameraSpeed = 15; // Increased speed from 5 to 15
const edgeThreshold = 20; // Distance from edge to trigger camera movement

let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;

function moveCamera() {
    if (moveLeft) cameraX -= cameraSpeed;
    if (moveRight) cameraX += cameraSpeed;
    if (moveUp) cameraY -= cameraSpeed;
    if (moveDown) cameraY += cameraSpeed;

    // Clamp camera position to game boundaries
    cameraX = Math.max(0, Math.min(cameraX, GAME_WIDTH - window.innerWidth));
    cameraY = Math.max(0, Math.min(cameraY, GAME_HEIGHT - window.innerHeight));
    updateCamera();
}

document.addEventListener('mousemove', (event) => {
    const { clientX, clientY } = event;
    const { innerWidth, innerHeight } = window;
    
    moveLeft = clientX <= edgeThreshold;
    moveRight = clientX >= innerWidth - edgeThreshold;
    moveUp = clientY <= edgeThreshold;
    moveDown = clientY >= innerHeight - edgeThreshold;
});

// Handle keyboard input
document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    
    // Handle spacebar
    if (key === ' ') {
        keys.space = true;
        return;
    }
    
    // Handle WASD
    if (key in keys) {
        keys[key] = true;
    }
    
    // Handle shift for speed boost
    if (key === 'shift') {
        speed = baseSpeed * 2; // Double the speed when shift is pressed
    }
    
    // Toggle camera follow with 'Y' key
    if (key === 'y') {
        cameraFollowEnabled = !cameraFollowEnabled;
    }
    
    // Building hotkeys (1,2,3)
    if (e.key >= '1' && e.key <= '3') {
        console.log('Building hotkey pressed:', e.key);
        const building = buildingOptions.find(b => b.dataset.key === e.key);
        if (building) {
            console.log('Found building:', building);
            selectBuilding(building);
        }
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    
    // Handle spacebar
    if (key === ' ') {
        keys.space = false;
        return;
    }
    
    // Handle WASD
    if (key in keys) {
        keys[key] = false;
    }
    
    // Reset speed when shift is released
    if (key === 'shift') {
        speed = baseSpeed;
    }
});

// Mouse position tracking
viewport.addEventListener('mousemove', (e) => {
    const rect = viewport.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

// Building placement
viewport.addEventListener('click', (e) => {
    if (selectedBuilding) {
        const { gridX, gridY, isValid } = updateGhostBuilding();
        if (isValid) {
            placeBuilding(gridX, gridY);
        }
    }
});

// Right click to cancel building placement
viewport.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (selectedBuilding) {
        selectBuilding(selectedBuilding);
    }
});

function selectBuilding(building) {
    console.log('Selecting building:', building);
    // Remove previous selection
    if (selectedBuilding) {
        selectedBuilding.classList.remove('selected');
    }
    
    // Add new selection
    if (building !== selectedBuilding) {
        building.classList.add('selected');
        selectedBuilding = building;
        console.log('New building selected');
    } else {
        selectedBuilding = null;
        console.log('Building deselected');
    }
    
    // Update build range visibility
    updateBuildRange();
}

function updateBuildRange() {
    if (selectedBuilding) {
        buildRange.style.display = 'block';
        buildRange.style.width = (BUILD_RANGE * 2) + 'px';
        buildRange.style.height = (BUILD_RANGE * 2) + 'px';
        
        // Use exact player position for smooth movement
        buildRange.style.left = (x + 25) + 'px';  // Add half player width
        buildRange.style.top = (y + 25) + 'px';   // Add half player height
    } else {
        buildRange.style.display = 'none';
    }
}

// Handle building clicks
buildingOptions.forEach(building => {
    building.addEventListener('click', () => selectBuilding(building));
});

// Performance monitoring
const performanceMonitor = {
    fpsCounter: document.getElementById('fps-counter'),
    frameTime: document.getElementById('frame-time'),
    memoryUsage: document.getElementById('memory-usage'),
    frameCount: 0,
    lastTime: performance.now(),
    lastFpsUpdate: 0,
    lastFrameTimeUpdate: 0,
    lastMemoryUpdate: 0,
    frameTimeAvg: 0,
    frameTimeCount: 0,
    
    update: function(currentTime) {
        this.frameCount++;
        const elapsed = currentTime - this.lastFpsUpdate;
        
        // Update FPS every second
        if (elapsed >= 1000) {
            const fps = Math.round((this.frameCount * 1000) / elapsed);
            this.fpsCounter.innerHTML = `<span class="perf-label">FPS: </span>${fps}`;
            this.frameCount = 0;
            this.lastFpsUpdate = currentTime;
        }
        
        // Calculate average frame time
        const frameTimeMs = currentTime - this.lastTime;
        this.frameTimeAvg += frameTimeMs;
        this.frameTimeCount++;
        
        // Update frame time display every 500ms
        if (currentTime - this.lastFrameTimeUpdate >= 500) {
            const avgFrameTime = (this.frameTimeAvg / this.frameTimeCount).toFixed(1);
            this.frameTime.innerHTML = `<span class="perf-label">Frame Time: </span>${avgFrameTime} ms`;
            this.frameTimeAvg = 0;
            this.frameTimeCount = 0;
            this.lastFrameTimeUpdate = currentTime;
        }
        
        // Update memory usage every 2 seconds if available
        if (window.performance && window.performance.memory && currentTime - this.lastMemoryUpdate >= 2000) {
            const memoryMB = Math.round(window.performance.memory.usedJSHeapSize / (1024 * 1024));
            this.memoryUsage.innerHTML = `<span class="perf-label">Memory: </span>${memoryMB} MB`;
            this.lastMemoryUpdate = currentTime;
        }
        
        this.lastTime = currentTime;
    }
};

function gameLoop(currentTime) {
    if (keys.w) y -= speed;
    if (keys.s) y += speed;
    if (keys.a) x -= speed;
    if (keys.d) x += speed;
    
    x = Math.max(0, Math.min(x, GAME_WIDTH - 50));
    y = Math.max(0, Math.min(y, GAME_HEIGHT - 50));
    
    if (keys.space) {
        centerCamera();
    }
    
    updatePosition();
    updateEnemies();
    updateCamera();
    updateGhostBuilding();
    updateBuildRange();
    moveCamera();
    
    // Update performance metrics
    performanceMonitor.update(currentTime);
    
    // Apply all position updates at once
    applyPendingUpdates();
    
    requestAnimationFrame(gameLoop);
}

// Initialize
initializeFog();
initializeMinimapFog();
initializeEnemyPool();
initializeSpawners();
centerCamera();
gameLoop();
