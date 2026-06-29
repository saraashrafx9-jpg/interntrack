// Global state
let currentUser = null;
let currentPage = 'home';

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    
    // Check if URL has page parameter
    const urlParams = new URLSearchParams(window.location.search);
    const pageParam = urlParams.get('page');
    
    if (pageParam === 'teams') {
        showPage('teams');
    } else {
        showPage('home');
    }
});

// Get token from multiple sources
function getToken() {
    // Try localStorage first
    let token = localStorage.getItem('token');
    if (token) return token;
    
    // Try cookie
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'token') return value;
    }
    
    return null;
}

// Page navigation
async function showPage(page) {
    currentPage = page;
    const container = document.getElementById('mainContent');
    
    switch(page) {
        case 'home':
            await loadHomePage(container);
            break;
        case 'teams':
            await loadTeamsPage(container);
            break;
        case 'login':
            loadLoginPage(container);
            break;
        default:
            await loadHomePage(container);
    }
    
    updateNavLinks();
}

// Load Home Page
async function loadHomePage(container) {
    try {
        console.log('Loading home page...');
        const [stats, achievements, teams] = await Promise.all([
            fetch('/api/statistics').then(r => r.json()),
            fetch('/api/achievements?limit=20').then(r => r.json()),
            fetch('/api/teams').then(r => r.json())
        ]);
        
        console.log('Data loaded:', { stats, achievements, teams });
        
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.totalTeams || 0}</div>
                    <div class="stat-label">Total Teams</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalAchievements || 0}</div>
                    <div class="stat-label">Total Achievements</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.totalLeaders || 0}</div>
                    <div class="stat-label">Team Leaders</div>
                </div>
            </div>
            
            <div class="card">
                <div class="search-bar">
                    <input type="text" id="searchInput" class="search-input" 
                           placeholder="Search achievements..." onkeyup="searchAchievements()">
                    <select id="teamFilter" class="form-select" onchange="filterAchievements()" 
                            style="width: auto;">
                        <option value="">All Teams</option>
                        ${teams.map(team => `
                            <option value="${team.TeamID}">${team.TeamName}</option>
                        `).join('')}
                    </select>
                </div>
                
                <h2 style="margin-bottom: 1.5rem;">Latest Achievements</h2>
                <div class="achievement-grid" id="achievementGrid">
                    ${achievements && achievements.length > 0 
                        ? achievements.map(achievement => createAchievementCard(achievement)).join('')
                        : '<p class="text-center">No achievements yet. Login as admin to create teams and leaders, then login as leader to post achievements.</p>'}
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading home page:', error);
        showToast('Failed to load content. Please check if the server is running.', 'error');
        container.innerHTML = '<p class="text-center" style="color: white;">Error loading content. Please make sure the server is running on port 3000.</p>';
    }
}

// Load Teams Page
async function loadTeamsPage(container) {
    try {
        const teams = await fetch('/api/teams').then(r => r.json());
        
        container.innerHTML = `
            <h1 style="margin-bottom: 2rem; color: white;">Teams</h1>
            <div class="achievement-grid">
                ${teams.length > 0 ? teams.map(team => `
                    <div class="card">
                        <h3>${team.TeamName}</h3>
                        <p style="color: var(--gray); margin: 1rem 0;">${team.Description || 'No description'}</p>
                        <div class="flex justify-between items-center">
                            <span style="color: var(--gray);">
                                <i class="fas fa-user"></i> Leader: ${team.LeaderName || 'Not assigned'}
                            </span>
                            <span class="team-badge">${team.AchievementCount || 0} achievements</span>
                        </div>
                        <button class="btn btn-primary mt-2" 
                                onclick="filterByTeam(${team.TeamID})">
                            View Achievements
                        </button>
                    </div>
                `).join('') : '<p class="text-center">No teams created yet.</p>'}
            </div>
        `;
    } catch (error) {
        console.error('Error loading teams:', error);
        showToast('Failed to load teams', 'error');
    }
}

// Load Login Page
// Load Login Page
function loadLoginPage(container) {
    container.innerHTML = `
        <div style="max-width: 400px; margin: 0 auto;">
            <div class="card">
                <h2 style="text-align: center; margin-bottom: 2rem;">Login</h2>
                <form onsubmit="handleLogin(event)">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" id="loginEmail" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Password</label>
                        <input type="password" id="loginPassword" class="form-input" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%;">
                        Login
                    </button>
                </form>
            </div>
        </div>
    `;
}

// Handle login
async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        console.log('Full login response:', data);
        
        if (response.ok && data.token) {
            // Store token manually in localStorage
            localStorage.setItem('token', data.token);
            
            console.log('Token stored:', data.token.substring(0, 30) + '...');
            
            showToast('Login successful!', 'success');
            
            // Build redirect URL with token
            const redirectUrl = data.redirectUrl + '?auth=' + encodeURIComponent(data.token);
            console.log('Redirecting to:', redirectUrl);
            
            setTimeout(() => {
                window.location.href = redirectUrl;
            }, 500);
        } else {
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed. Please try again.', 'error');
    }
}

// Handle logout
async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    // Clear everything
    localStorage.removeItem('token');
    document.cookie = 'token=; path=/; max-age=0';
    currentUser = null;
    updateUIForUnauth();
    showToast('Logged out successfully', 'success');
    showPage('home');
}

// Create Achievement Card HTML
function createAchievementCard(achievement) {
    const date = new Date(achievement.DatePosted).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    
    // Build image HTML if there are images
    let imageHtml = '';
    if (achievement.FirstImage) {
        imageHtml = `<img src="${achievement.FirstImage}" class="achievement-image" alt="${escapeHtml(achievement.Title)}" style="width: 100%; height: 200px; object-fit: cover;" onerror="this.style.display='none'">`;
    } else if (achievement.ImageCount > 0) {
        imageHtml = `<div style="height: 200px; background: linear-gradient(135deg, #4a7099 0%, #355a7d 100%); display: flex; align-items: center; justify-content: center; color: white; font-size: 3rem;">
            <i class="fas fa-image"></i>
        </div>`;
    }
    
    return `
        <div class="achievement-card" onclick="viewAchievement(${achievement.AchievementID})" style="cursor: pointer;">
            ${imageHtml}
            <div class="achievement-body">
                <h3 class="achievement-title">${escapeHtml(achievement.Title)}</h3>
                <p class="achievement-description">
                    ${achievement.Description ? escapeHtml(achievement.Description.substring(0, 150)) + (achievement.Description.length > 150 ? '...' : '') : ''}
                </p>
                <div class="achievement-meta">
                    <span class="team-badge">${escapeHtml(achievement.TeamName || 'Unknown Team')}</span>
                    <span><i class="far fa-calendar"></i> ${date}</span>
                </div>
                <div class="flex gap-1 mt-1" style="font-size: 0.875rem; color: var(--gray);">
                    <span><i class="far fa-heart"></i> ${achievement.LikeCount || 0}</span>
                    <span><i class="far fa-comment"></i> ${achievement.CommentCount || 0}</span>
                    ${achievement.ImageCount > 0 ? `<span><i class="far fa-image"></i> ${achievement.ImageCount}</span>` : ''}
                    <span>by ${escapeHtml(achievement.CreatorName || 'Unknown')}</span>
                </div>
            </div>
        </div>
    `;
}

// Helper to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Search and Filter Functions
async function searchAchievements() {
    const searchTerm = document.getElementById('searchInput')?.value;
    const teamId = document.getElementById('teamFilter')?.value;
    
    const params = new URLSearchParams();
    if (searchTerm) params.append('search', searchTerm);
    if (teamId) params.append('teamId', teamId);
    
    try {
        const achievements = await fetch(`/api/achievements?${params}`).then(r => r.json());
        updateAchievementGrid(achievements);
    } catch (error) {
        console.error('Search error:', error);
    }
}

async function filterAchievements() {
    await searchAchievements();
}

function filterByTeam(teamId) {
    showPage('home').then(() => {
        const teamFilter = document.getElementById('teamFilter');
        if (teamFilter) {
            teamFilter.value = teamId;
            filterAchievements();
        }
    });
}

function updateAchievementGrid(achievements) {
    const grid = document.getElementById('achievementGrid');
    if (grid) {
        grid.innerHTML = achievements.length > 0 
            ? achievements.map(a => createAchievementCard(a)).join('')
            : '<p class="text-center">No achievements found.</p>';
    }
}

// View Achievement Detail
async function viewAchievement(id) {
    try {
        const achievement = await fetch(`/api/achievements/${id}`).then(r => r.json());
        const container = document.getElementById('mainContent');
        
        const date = new Date(achievement.DatePosted).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Build images gallery
        let imagesHtml = '';
        if (achievement.images && achievement.images.length > 0) {
            imagesHtml = `
                <div class="image-gallery" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0;">
                    ${achievement.images.map(img => `
                        <img src="${img.FilePath}" 
                             style="width: 100%; height: 200px; object-fit: cover; border-radius: 8px; cursor: pointer;"
                             onclick="window.open('${img.FilePath}', '_blank')"
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><rect fill=%22%23ddd%22 width=%22200%22 height=%22200%22/><text x=%2250%25%22 y=%2250%25%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23999%22>Image not found</text></svg>'">
                    `).join('')}
                </div>
            `;
        }
        
        container.innerHTML = `
            <div class="card">
                <button onclick="showPage('home')" class="btn btn-sm mb-2">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                
                <h1>${escapeHtml(achievement.Title)}</h1>
                <div class="flex gap-1 items-center mt-1" style="color: var(--gray); flex-wrap: wrap;">
                    <span class="team-badge">${escapeHtml(achievement.TeamName)}</span>
                    <span>by ${escapeHtml(achievement.CreatorName)}</span>
                    <span><i class="far fa-calendar"></i> ${date}</span>
                </div>
                
                ${imagesHtml}
                
                <div style="white-space: pre-wrap; line-height: 1.8; margin: 1.5rem 0; font-size: 1.05rem;">
                    ${escapeHtml(achievement.Description)}
                </div>
                
                <div class="flex gap-1 mt-2" style="border-top: 1px solid #E5E7EB; padding-top: 1rem;">
                    <button class="btn btn-sm" onclick="toggleLike(${id})">
                        <i class="far fa-heart"></i> Like (${achievement.likeCount || 0})
                    </button>
                </div>
                
                <div class="mt-2">
                    <h3>Comments (${achievement.comments ? achievement.comments.length : 0})</h3>
                    <form onsubmit="addComment(event, ${id})" class="mt-1">
                        <div class="form-group">
                            <input type="text" id="commentAuthor" class="form-input" 
                                   placeholder="Your name" required>
                        </div>
                        <div class="form-group">
                            <textarea id="commentContent" class="form-textarea" 
                                      placeholder="Write a comment..." required></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary btn-sm">
                            <i class="fas fa-comment"></i> Add Comment
                        </button>
                    </form>
                    
                    <div id="commentsList" class="mt-2">
                        ${achievement.comments && achievement.comments.length > 0 ? achievement.comments.map(comment => `
                            <div class="comment" style="background: #f4f4ed; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem;">
                                <div class="comment-author" style="font-weight: 600; color: #355a7d;">${escapeHtml(comment.AuthorName)}</div>
                                <div style="margin: 0.5rem 0;">${escapeHtml(comment.Content)}</div>
                                <div class="comment-date" style="font-size: 0.75rem; color: #6B7280;">
                                    ${new Date(comment.CreatedAt).toLocaleString()}
                                </div>
                            </div>
                        `).join('') : '<p style="color: #6B7280;">No comments yet. Be the first to comment!</p>'}
                    </div>
                </div>
            </div>
        `;
        
        currentPage = 'achievement';
    } catch (error) {
        console.error('Error viewing achievement:', error);
        showToast('Failed to load achievement', 'error');
    }
}

// Like functionality
async function toggleLike(achievementId) {
    try {
        const response = await fetch(`/api/achievements/${achievementId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            viewAchievement(achievementId);
        }
    } catch (error) {
        console.error('Error toggling like:', error);
    }
}

// Comment functionality
async function addComment(event, achievementId) {
    event.preventDefault();
    
    const authorName = document.getElementById('commentAuthor').value;
    const content = document.getElementById('commentContent').value;
    
    try {
        const response = await fetch(`/api/achievements/${achievementId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authorName, content })
        });
        
        if (response.ok) {
            viewAchievement(achievementId);
            showToast('Comment added successfully', 'success');
        }
    } catch (error) {
        console.error('Error adding comment:', error);
    }
}

// Navigation Helpers
function updateNavLinks() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.textContent.toLowerCase().includes(currentPage)) {
            link.classList.add('active');
        }
    });
}

function toggleMenu() {
    document.getElementById('navMenu').classList.toggle('active');
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// Check authentication status
async function checkAuthStatus() {
    const token = getToken();
    
    if (!token) {
        currentUser = null;
        updateUIForUnauth();
        return;
    }
    
    try {
        const response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            currentUser = await response.json();
            updateUIForAuth();
        } else {
            // Token is invalid
            localStorage.removeItem('token');
            document.cookie = 'token=; path=/; max-age=0';
            currentUser = null;
            updateUIForUnauth();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        currentUser = null;
        updateUIForUnauth();
    }
}

function updateUIForAuth() {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    
    if (loginBtn) loginBtn.style.display = 'none';
    if (userMenu) {
        userMenu.style.display = 'flex';
        
        const dashboardBtn = document.getElementById('dashboardBtn');
        if (dashboardBtn && currentUser) {
            if (currentUser.Role === 'Admin') {
                dashboardBtn.textContent = 'Admin Dashboard';
                dashboardBtn.onclick = () => window.location.href = '/admin-dashboard.html';
            } else if (currentUser.Role === 'Leader') {
                dashboardBtn.textContent = 'My Dashboard';
                dashboardBtn.onclick = () => window.location.href = '/leader-dashboard.html';
            }
        }
    }
}

function updateUIForUnauth() {
    const loginBtn = document.getElementById('loginBtn');
    const userMenu = document.getElementById('userMenu');
    
    if (loginBtn) loginBtn.style.display = 'block';
    if (userMenu) userMenu.style.display = 'none';
}

function showDashboard() {
    if (currentUser?.Role === 'Admin') {
        window.location.href = '/admin-dashboard.html';
    } else if (currentUser?.Role === 'Leader') {
        window.location.href = '/leader-dashboard.html';
    }
}