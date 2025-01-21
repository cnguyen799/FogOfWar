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
const MINIMAP_SIZE = 200;
const GRID_SIZE = 50;
const BUILD_RANGE = 200;  // Reduced from 300 to 200 for smaller range
const CHUNK_SIZE = 100;  // Changed from 50 to 100
const VISION_RANGE = 250; // Reveal 5x5 grid squares around player
const ENEMY_SPEED = 2;
const SPAWN_INTERVAL = 3000; // Spawn every 3 seconds
const MAX_SPAWNERS = 4; // Maximum number of spawners
const MIN_SPAWNER_DISTANCE = 800; // Minimum distance between spawners and from player start
const MAX_ENEMIES_PER_SPAWNER = 3;

// Initialize fog of war
const chunks = new Map(); // Store fog chunks by their coordinates
const minimapChunks = new Map();
const enemies = [];
const placedBuildings = [];
const spawners = [];

function createSpawner(x, y) {
    const spawner = document.createElement('div');
    spawner.className = 'spawner';
    spawner.style.position = 'absolute';
    spawner.style.left = `${x}px`;
    spawner.style.top = `${y}px`;
    document.getElementById('gameArea').appendChild(spawner);

    // Create minimap indicator for the spawner
    const minimapSpawner = document.createElement('div');
    minimapSpawner.className = 'minimap-spawner';
    minimapSpawner.style.left = (x / GAME_WIDTH) * MINIMAP_SIZE + 'px';
    minimapSpawner.style.top = (y / GAME_HEIGHT) * MINIMAP_SIZE + 'px';
    document.getElementById('minimap').appendChild(minimapSpawner);
    
    // Store spawner with its dimensions and minimap element
    const spawnerObj = { 
        x, 
        y, 
        width: 100, 
        height: 100,
        element: spawner,
        minimapElement: minimapSpawner,
        type: 'spawner',
        activeEnemies: 0
    };
    
    spawners.push(spawnerObj);
    placedBuildings.push(spawnerObj);
    
    // Start spawning enemies
    setInterval(() => {
        if (spawnerObj.activeEnemies < MAX_ENEMIES_PER_SPAWNER) {
            spawnEnemy(spawnerObj);
        }
    }, SPAWN_INTERVAL);
    
    return spawnerObj;
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

function spawnEnemy(spawner) {
    const enemy = document.createElement('div');
    enemy.className = 'enemy';
    
    // Spawn at random position around the spawner
    const spawnRadius = 100;
    const angle = Math.random() * Math.PI * 2;
    const spawnX = spawner.x + 50 + Math.cos(angle) * spawnRadius;
    const spawnY = spawner.y + 50 + Math.sin(angle) * spawnRadius;
    
    enemy.style.left = `${spawnX}px`;
    enemy.style.top = `${spawnY}px`;
    enemiesContainer.appendChild(enemy);

    // Create minimap indicator for the enemy
    const minimapEnemy = document.createElement('div');
    minimapEnemy.className = 'minimap-enemy';
    minimapEnemy.style.left = (spawnX / GAME_WIDTH) * MINIMAP_SIZE + 'px';
    minimapEnemy.style.top = (spawnY / GAME_HEIGHT) * MINIMAP_SIZE + 'px';
    minimapEnemiesContainer.appendChild(minimapEnemy);
    
    const enemyObj = {
        x: spawnX,
        y: spawnY,
        element: enemy,
        minimapElement: minimapEnemy,
        spawner: spawner
    };
    
    spawner.activeEnemies++;
    enemies.push(enemyObj);
}

function removeEnemy(enemy) {
    // Remove from DOM
    enemy.element.remove();
    enemy.minimapElement.remove();
    
    // Decrease spawner's active enemy count
    enemy.spawner.activeEnemies--;
    
    // Remove from enemies array
    const index = enemies.indexOf(enemy);
    if (index > -1) {
        enemies.splice(index, 1);
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
    
    // Calculate visible area in chunks around player
    const visibleStartX = playerChunkX - 5;
    const visibleEndX = playerChunkX + 5;
    const visibleStartY = playerChunkY - 5;
    const visibleEndY = playerChunkY + 5;
    
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

function updateEnemies() {
    enemies.forEach(enemy => {
        // Move towards player
        const dx = x - enemy.x;
        const dy = y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            enemy.x += (dx / distance) * ENEMY_SPEED;
            enemy.y += (dy / distance) * ENEMY_SPEED;
            
            // Update enemy position
            enemy.element.style.left = `${enemy.x}px`;
            enemy.element.style.top = `${enemy.y}px`;
            
            // Update minimap position
            enemy.minimapElement.style.left = (enemy.x / GAME_WIDTH) * MINIMAP_SIZE + 'px';
            enemy.minimapElement.style.top = (enemy.y / GAME_HEIGHT) * MINIMAP_SIZE + 'px';
        }
    });
}

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

function gameLoop() {
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
    
    requestAnimationFrame(gameLoop);
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

// Initialize
initializeFog();
initializeMinimapFog();
initializeSpawners(); // Add spawner initialization
centerCamera();
gameLoop();