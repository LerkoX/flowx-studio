// Mobile menu toggle
const sidebar = document.querySelector('.sidebar');
const content = document.querySelector('.content');

if (window.innerWidth <= 768) {
    const menuBtn = document.createElement('button');
    menuBtn.innerHTML = '☰';
    menuBtn.className = 'menu-toggle';
    menuBtn.style.cssText = `
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 200;
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 1.2rem;
    `;
    document.body.appendChild(menuBtn);
    
    menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
    
    content.addEventListener('click', () => {
        sidebar.classList.remove('open');
    });
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ============ Mermaid Fullscreen & Zoom ==============
let currentScale = 1;
let isDragging = false;
let startX, startY, translateX = 0, translateY = 0;
let currentSvgWrapper = null;

function toggleMermaidFullscreen(btn) {
    const container = btn.closest('.mermaid-container');
    const mermaidDiv = container.querySelector('.mermaid');
    const overlay = document.getElementById('mermaid-overlay');
    const overlayDiagram = document.getElementById('mermaid-overlay-diagram');
    
    // Get the rendered SVG from the mermaid diagram
    const svg = mermaidDiv.querySelector('svg');
    if (!svg) return;
    
    // Clone the SVG for the overlay
    const clonedSvg = svg.cloneNode(true);
    
    // Reset transform state
    currentScale = 1;
    translateX = 0;
    translateY = 0;
    
    // Create a wrapper for transform
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-zoom-wrapper';
    wrapper.style.transform = 'translate(0px, 0px) scale(1)';
    wrapper.appendChild(clonedSvg);
    currentSvgWrapper = wrapper;
    
    // Clear and add to overlay
    overlayDiagram.innerHTML = '';
    overlayDiagram.appendChild(wrapper);
    
    // Update scale display
    updateScaleDisplay();
    
    // Show overlay
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Auto-fit to screen on first open
    setTimeout(() => autoFitDiagram(clonedSvg), 50);
}

function autoFitDiagram(svg) {
    const overlayDiagram = document.getElementById('mermaid-overlay-diagram');
    const containerW = overlayDiagram.clientWidth - 80;
    const containerH = overlayDiagram.clientHeight - 80;
    
    const svgW = svg.clientWidth || svg.getBoundingClientRect().width;
    const svgH = svg.clientHeight || svg.getBoundingClientRect().height;
    
    if (svgW && svgH) {
        const scaleX = containerW / svgW;
        const scaleY = containerH / svgH;
        currentScale = Math.min(scaleX, scaleY, 3); // max 3x
        if (currentScale < 0.3) currentScale = 0.3;
        if (currentScale > 2) currentScale = 2;
        applyTransform();
        updateScaleDisplay();
    }
}

function closeMermaidFullscreen(event) {
    if (event.target.id === 'mermaid-overlay' || event.target.closest('.mermaid-close-btn')) {
        const overlay = document.getElementById('mermaid-overlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        currentSvgWrapper = null;
    }
}

// Zoom controls
function zoomIn() {
    currentScale = Math.min(currentScale * 1.25, 5);
    applyTransform();
    updateScaleDisplay();
}

function zoomOut() {
    currentScale = Math.max(currentScale / 1.25, 0.2);
    applyTransform();
    updateScaleDisplay();
}

function zoomReset() {
    currentScale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform();
    updateScaleDisplay();
}

function zoomFit() {
    if (!currentSvgWrapper) return;
    const svg = currentSvgWrapper.querySelector('svg');
    if (svg) autoFitDiagram(svg);
}

function applyTransform() {
    if (currentSvgWrapper) {
        currentSvgWrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentScale})`;
    }
}

function updateScaleDisplay() {
    const display = document.getElementById('mermaid-scale-display');
    if (display) {
        display.textContent = Math.round(currentScale * 100) + '%';
    }
}

// Mouse wheel zoom
const overlayDiagram = document.getElementById('mermaid-overlay-diagram');
if (overlayDiagram) {
    overlayDiagram.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.2, Math.min(5, currentScale * delta));
        
        // Zoom towards mouse pointer
        const rect = overlayDiagram.getBoundingClientRect();
        const mouseX = e.clientX - rect.left - rect.width / 2;
        const mouseY = e.clientY - rect.top - rect.height / 2;
        
        const scaleRatio = newScale / currentScale;
        translateX = mouseX - (mouseX - translateX) * scaleRatio;
        translateY = mouseY - (mouseY - translateY) * scaleRatio;
        currentScale = newScale;
        
        applyTransform();
        updateScaleDisplay();
    }, { passive: false });
    
    // Pan / drag
    overlayDiagram.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Only left click
        isDragging = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        overlayDiagram.style.cursor = 'grabbing';
    });
    
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        applyTransform();
    });
    
    window.addEventListener('mouseup', () => {
        isDragging = false;
        if (overlayDiagram) overlayDiagram.style.cursor = 'grab';
    });
}

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('mermaid-overlay');
        if (overlay.classList.contains('active')) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
            currentSvgWrapper = null;
        }
    }
});

// Highlight active section in sidebar on scroll
const headings = document.querySelectorAll('h2[id], h3[id]');
if (headings.length > 0) {
    window.addEventListener('scroll', () => {
        let current = '';
        headings.forEach(heading => {
            const sectionTop = heading.offsetTop;
            if (scrollY >= sectionTop - 100) {
                current = heading.getAttribute('id');
            }
        });
    });
}
