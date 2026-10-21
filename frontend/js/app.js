/**
 * CampusSkillConnect — Shared Frontend Application Logic
 * 
 * Clean, readable Vanilla JavaScript designed for:
 * 1. Straightforward peer-to-peer student exchange workflows
 * 2. Robust REST API integration using window.fetch()
 * 3. Clear college viva explanation (Auth, State, DOM, Async/Await)
 */

// ==========================================================================
// 1. Configuration & Constants
// ==========================================================================

const CSC_CONFIG = {
  // Configurable API base URL: defaults to relative '/api' or custom stored port
  // Useful when backend runs on http://localhost:5000/api or http://localhost:8000/api
  DEFAULT_API_BASE: 'http://localhost:5000/api',
  STORAGE_TOKEN_KEY: 'csc_token',
  STORAGE_USER_KEY: 'csc_user',
  STORAGE_API_KEY: 'csc_api_base',
};

/**
 * Returns the active API base URL
 */
function getApiBase() {
  return localStorage.getItem(CSC_CONFIG.STORAGE_API_KEY) || CSC_CONFIG.DEFAULT_API_BASE;
}

/**
 * Updates the active API base URL (e.g. if backend runs on port 3000, 5000, 8000)
 */
function setApiBase(newUrl) {
  if (newUrl) {
    const cleaned = newUrl.replace(/\/+$/, ''); // Remove trailing slashes
    localStorage.setItem(CSC_CONFIG.STORAGE_API_KEY, cleaned);
  }
}

// ==========================================================================
// 2. Authentication & Session Helpers
// ==========================================================================

/**
 * Retrieve saved authentication token
 */
function getAuthToken() {
  return localStorage.getItem(CSC_CONFIG.STORAGE_TOKEN_KEY) || null;
}

/**
 * Save authentication token after successful login/registration
 */
function setAuthToken(token) {
  if (token) {
    localStorage.setItem(CSC_CONFIG.STORAGE_TOKEN_KEY, token);
  }
}

/**
 * Retrieve cached authenticated user profile
 */
function getAuthUser() {
  const raw = localStorage.getItem(CSC_CONFIG.STORAGE_USER_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Save current authenticated user profile
 */
function setAuthUser(user) {
  if (user) {
    localStorage.setItem(CSC_CONFIG.STORAGE_USER_KEY, JSON.stringify(user));
  }
}

/**
 * Clear authentication session and all cached user data
 */
function clearAuth() {
  localStorage.removeItem(CSC_CONFIG.STORAGE_TOKEN_KEY);
  localStorage.removeItem(CSC_CONFIG.STORAGE_USER_KEY);
  try {
    sessionStorage.clear();
  } catch (e) {
    // Ignore if storage access is restricted
  }
}

/**
 * Check if the user is currently authenticated
 */
function isAuthenticated() {
  return !!getAuthToken();
}

/**
 * Protects an application page. If the user is not authenticated,
 * immediately hides page content and redirects to login.html.
 */
function requireAuth() {
  if (!isAuthenticated()) {
    if (document.body) {
      document.body.style.display = 'none';
    }
    const current = encodeURIComponent(window.location.pathname.split('/').pop() || 'dashboard.html');
    window.location.replace(`login.html?redirect=${current}`);
    return false;
  }
  return true;
}

/**
 * If user is already authenticated and visits login/register,
 * redirect them straight to dashboard.html.
 */
function redirectIfAuth() {
  if (isAuthenticated()) {
    window.location.replace('dashboard.html');
    return true;
  }
  return false;
}

/**
 * Perform logout: calls POST /api/auth/logout with session credentials,
 * clears token and cached user data, and redirects to login.html.
 */
async function logoutUser() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (err) {
    console.warn('Logout API notification failed or offline:', err);
  } finally {
    clearAuth();
    showToast('You have been signed out.', 'info');
    setTimeout(() => {
      window.location.replace('login.html');
    }, 350);
  }
}

// ==========================================================================
// 3. Centralized API Fetch Service
// ==========================================================================

/**
 * Standardized API caller with error handling, authentication headers,
 * and JSON request/response handling.
 * 
 * @param {string} endpoint - Relative path (e.g. '/auth/login', '/skills')
 * @param {object} options - Fetch options (method, headers, body)
 * @returns {Promise<{success: boolean, data?: any, error?: string, status: number}>}
 */
async function apiFetch(endpoint, options = {}) {
  const baseUrl = getApiBase();
  // Ensure endpoint starts with a slash
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Destructure to prevent options from overriding credentials or headers
  const { headers: _ignoredHeaders, credentials: _ignoredCreds, ...restOptions } = options;
  const fetchOptions = {
    ...restOptions,
    credentials: 'include',  // Always include cookies for session support
    headers
  };

  try {
    const response = await fetch(url, fetchOptions);
    const status = response.status;

    // Handle 401 Unauthorized — but NOT for /auth/me or /profile (handled with fallbacks on profile page)
    // to avoid redirect loops on page load when no session cookie exists yet
    if (
      status === 401 &&
      !endpoint.includes('/auth/login') &&
      !endpoint.includes('/auth/register') &&
      !endpoint.includes('/auth/me') &&
      !endpoint.includes('/profile')
    ) {
      clearAuth();
      showToast('Your session has expired. Please sign in again.', 'warning');
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1200);
      return { success: false, status, error: 'Unauthorized' };
    }

    // Try parsing JSON response
    let data = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = { message: text };
    }

    if (!response.ok) {
      const errorMessage = data?.message || data?.error || `Request failed with status ${status}`;
      return { success: false, status, error: errorMessage, data };
    }

    return { success: true, status, data };
  } catch (networkError) {
    console.error(`API Error calling ${url}:`, networkError);
    return {
      success: false,
      status: 0,
      isNetworkError: true,
      error: `Could not connect to backend server at ${baseUrl}. Ensure backend is running.`
    };
  }
}

// ==========================================================================
// 4. UI Notifications (Toast System)
// ==========================================================================

/**
 * Displays a non-intrusive floating toast notification
 * @param {string} message - Message text
 * @param {'success'|'error'|'warning'|'info'} type - Toast type
 * @param {number} duration - Milliseconds before auto-dismiss
 */
function showToast(message, type = 'info', duration = 3800) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span style="font-weight: 800; font-size: 1.1rem; line-height: 1;">${icons[type] || 'ℹ'}</span>
    <span style="flex: 1; line-height: 1.4;">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ==========================================================================
// 5. Reusable Component State Renderers
// ==========================================================================

/**
 * Renders an empty state block
 */
function renderEmptyState(container, { title, message, actionText, actionLink, onAction }) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <h3 class="empty-state-title">${escapeHtml(title || 'No items to display')}</h3>
      <p class="empty-state-text">${escapeHtml(message || 'There is no data recorded yet.')}</p>
      ${actionText ? `
        <button class="btn btn-primary btn-sm" id="empty-state-action-btn">
          ${escapeHtml(actionText)}
        </button>
      ` : ''}
    </div>
  `;

  if (actionText) {
    const btn = container.querySelector('#empty-state-action-btn');
    if (btn) {
      if (actionLink) {
        btn.addEventListener('click', () => window.location.href = actionLink);
      } else if (typeof onAction === 'function') {
        btn.addEventListener('click', onAction);
      }
    }
  }
}

/**
 * Renders an error state with a clean retry button
 */
function renderErrorState(container, { message, onRetry }) {
  if (!container) return;
  container.innerHTML = `
    <div class="alert alert-error" style="display: flex; flex-direction: column; gap: 12px; align-items: flex-start;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="alert-icon">⚠</span>
        <strong>Unable to Load Data</strong>
      </div>
      <p style="margin: 0; color: inherit; font-size: 0.9rem;">
        ${escapeHtml(message || 'The server could not be reached. Please verify the backend is active.')}
      </p>
      <div style="display: flex; gap: 10px; margin-top: 4px;">
        ${onRetry ? `<button class="btn btn-outline btn-sm" id="error-retry-btn" style="background:#FFF;">↻ Retry</button>` : ''}
        <button class="btn btn-outline btn-sm" id="error-config-btn" style="background:#FFF;">⚙ Change API URL</button>
      </div>
    </div>
  `;

  if (onRetry) {
    const retryBtn = container.querySelector('#error-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', onRetry);
  }

  const configBtn = container.querySelector('#error-config-btn');
  if (configBtn) {
    configBtn.addEventListener('click', openApiConfigModal);
  }
}

/**
 * Renders a loading spinner block
 */
function renderLoadingState(container, text = 'Loading data from backend...') {
  if (!container) return;
  container.innerHTML = `
    <div class="loading-box">
      <div class="spinner"></div>
      <p style="font-size: 0.9rem; font-weight: 500;">${escapeHtml(text)}</p>
    </div>
  `;
}

// ==========================================================================
// 6. Modal Dialog Helper
// ==========================================================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Global click listener to close modals when clicking on overlay or close button
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    document.body.style.overflow = '';
  }
  if (e.target.closest('[data-modal-close]')) {
    const modal = e.target.closest('.modal-overlay');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }
});

// ==========================================================================
// ==========================================================================
// 7. Backend Connection & Health Status Indicator
// ==========================================================================

/**
 * Tests connection to backend health endpoint and updates indicator badge
 */
async function checkBackendConnection() {
  const indicator = document.getElementById('backend-indicator');
  const dot = document.getElementById('backend-dot');
  const text = document.getElementById('backend-text');

  if (!indicator || !dot || !text) return;

  text.textContent = 'Checking...';
  dot.className = 'backend-dot';

  try {
    const response = await fetch(`${getApiBase()}/health`, {
      method: 'GET',
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.database === 'connected' || data.status === 'ok') {
        dot.className = 'backend-dot connected';
        text.textContent = 'Backend Online';
        indicator.title = `Connected to ${getApiBase()} (Database: connected)`;
      } else {
        dot.className = 'backend-dot error';
        text.textContent = 'DB Offline';
        indicator.title = `Backend reachable but database is disconnected`;
      }
    } else {
      dot.className = 'backend-dot error';
      text.textContent = 'Backend Error';
      indicator.title = `Backend returned status ${response.status}`;
    }
  } catch (err) {
    dot.className = 'backend-dot error';
    text.textContent = 'Backend Offline';
    indicator.title = `Cannot reach ${getApiBase()}. Click to configure URL.`;
  }
}

/**
 * Opens an API URL configuration modal (for viva demo or port changes)
 */
function openApiConfigModal() {
  let modal = document.getElementById('modal-api-config');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-api-config';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h3 class="modal-title">Backend API Configuration</h3>
          <button class="modal-close" data-modal-close>&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-sm text-secondary" style="margin-bottom: 16px;">
            Configure the backend server URL that CampusSkillConnect will communicate with. Default is typically <code>http://localhost:5000/api</code>.
          </p>
          <div class="form-group">
            <label class="form-label" for="cfg-api-url">API Base URL</label>
            <input type="text" id="cfg-api-url" class="form-control" value="${escapeHtml(getApiBase())}" placeholder="http://localhost:5000/api">
            <div class="form-hint">Expected endpoints: /auth, /skills, /matches, /sessions, /profile</div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline btn-sm" data-modal-close>Cancel</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-save-api-config">Save & Connect</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-save-api-config').addEventListener('click', () => {
      const input = modal.querySelector('#cfg-api-url');
      if (input && input.value.trim()) {
        setApiBase(input.value.trim());
        showToast('API URL updated!', 'success');
        closeModal('modal-api-config');
        checkBackendConnection();
        // Trigger current page reload or re-fetch
        if (typeof window.refreshCurrentPageData === 'function') {
          window.refreshCurrentPageData();
        }
      }
    });
  }

  openModal('modal-api-config');
}

// ==========================================================================
// 8. Shared App Layout Initializer
// ==========================================================================

/**
 * Formats academic year values (numeric or text) for consistent UI display
 */
function formatAcademicYear(year) {
  if (!year) return 'Student';
  if (typeof year === 'string' && year.toLowerCase().includes('year')) return year;
  const num = parseInt(year, 10);
  if (isNaN(num)) return String(year);
  if (num === 1) return '1st Year';
  if (num === 2) return '2nd Year';
  if (num === 3) return '3rd Year';
  if (num === 4) return '4th Year';
  if (num >= 5) return 'Postgraduate';
  return `${num}th Year`;
}

/**
 * Updates all student name, role/dept, and avatar elements across the current page
 */
function updateUserUI(user) {
  if (!user) return;
  const displayName = user.full_name || user.name || 'Student';
  const department = user.department || 'Department';
  const yearText = formatAcademicYear(user.academic_year || user.year);
  const roleText = `${department} • ${yearText}`;
  const initial = displayName.trim().charAt(0).toUpperCase() || 'S';

  const nameEls = document.querySelectorAll('[data-user-name]');
  const deptEls = document.querySelectorAll('[data-user-dept]');
  const avatarEls = document.querySelectorAll('[data-user-avatar]');

  nameEls.forEach(el => el.textContent = displayName);
  deptEls.forEach(el => el.textContent = roleText);
  avatarEls.forEach(el => el.textContent = initial);
}

/**
 * Displays a clear error in place of student name when the profile request fails
 */
function setUserUIError(message) {
  const nameEls = document.querySelectorAll('[data-user-name]');
  const deptEls = document.querySelectorAll('[data-user-dept]');
  nameEls.forEach(el => el.textContent = 'Error loading user');
  deptEls.forEach(el => el.textContent = message || 'Not authenticated');
}

/**
 * Initializes sidebar, active nav highlights, authenticated student info, and mobile menu.
 * Waits for the current-user request (/api/auth/me) to ensure the logged-in student's
 * actual name is rendered in the sidebar.
 */
async function initAppLayout(activePageName) {
  // 1. Immediately render cached student info to prevent UI flicker
  const cachedUser = getAuthUser();
  if (cachedUser) {
    updateUserUI(cachedUser);
  }

  // 2. Initialize connection indicator immediately
  const indicator = document.getElementById('backend-indicator');
  if (indicator) {
    indicator.addEventListener('click', openApiConfigModal);
    checkBackendConnection();
  }

  // 3. Highlight active link and ensure nav links bypass stale browser cache
  document.querySelectorAll('a.nav-menu-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.endsWith('.html')) {
      link.setAttribute('href', `${href}?v=2`);
    }
  });

  if (activePageName) {
    const activeLink = document.querySelector(`.nav-menu-link[data-page="${activePageName}"]`);
    if (activeLink) {
      activeLink.classList.add('active');
    }
  }

  // 4. Mobile sidebar toggle
  const mobileToggle = document.getElementById('mobile-sidebar-toggle');
  const sidebar = document.querySelector('.app-sidebar');
  let backdrop = document.querySelector('.sidebar-backdrop');

  if (mobileToggle && sidebar) {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('active');
    });

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
    });
  }

  // 5. Logout button listener
  const logoutButtons = document.querySelectorAll('[data-action="logout"]');
  logoutButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      logoutUser();
    });
  });

  // 6. Fetch the latest authenticated student from backend GET /api/auth/me
  // Waits for the current-user request and renders the actual student's name
  try {
    const meResult = await apiFetch('/auth/me');
    if (meResult.success && meResult.data) {
      const currentUser = meResult.data.user || meResult.data;
      setAuthUser(currentUser);
      updateUserUI(currentUser);
    } else {
      if (meResult.isNetworkError) {
        setUserUIError('Backend Offline');
      } else if (meResult.status !== 401) {
        setUserUIError(meResult.error || 'Failed to load profile');
      }
    }
  } catch (err) {
    console.error('Failed to load current student profile:', err);
    setUserUIError('Connection Error');
  }
}

// ==========================================================================
// 9. Utility Functions
// ==========================================================================

/**
 * Escape HTML to prevent XSS attacks when rendering dynamic text
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format ISO date string into readable format (e.g. "Oct 24, 2026")
 */
function formatDate(isoString) {
  if (!isoString) return 'Date not specified';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return isoString;
  }
}

/**
 * Format time string into readable 12-hour format (e.g. "03:30 PM")
 */
function formatTime(timeString) {
  if (!timeString) return '';
  // Check if it's already HH:MM
  const match = timeString.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return timeString;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}
