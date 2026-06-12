(function() {
            'use strict';

            const CONFIG = {
                redirects: {
                    owner: 'gym_owner_panel.html',
                    member: 'Members_Section.html',
                    zumba: 'Zumba_Members_Section.html'
                },
                storageKey: 'gym_saved_credentials'
            };

            const state = {
                currentRole: null,
                isLoading: false
            };

            const elements = {
                screens: {
                    selection: document.getElementById('selectionScreen'),
                    login: document.getElementById('loginScreen'),
                    dashboard: document.getElementById('dashboardScreen')
                },
                selectionCards: document.querySelectorAll('.selection-card'),
                backBtn: document.getElementById('backBtn'),
                loginForm: document.getElementById('loginForm'),
                loginId: document.getElementById('loginId'),
                password: document.getElementById('password'),
                passwordToggle: document.getElementById('passwordToggle'),
                loginBtn: document.getElementById('loginBtn'),
                loginTypeBadge: document.getElementById('loginTypeBadge'),
                errorMessage: document.getElementById('errorMessage'),
                demoId: document.getElementById('demoId'),
                demoPassword: document.getElementById('demoPassword'),
                demoCredentials: document.getElementById('demoCredentials'),
                dashboardRole: document.getElementById('dashboardRole'),
                userType: document.getElementById('userType'),
                userLoginId: document.getElementById('userLoginId'),
                sessionTime: document.getElementById('sessionTime'),
                logoutBtn: document.getElementById('logoutBtn'),
                rememberMe: document.getElementById('rememberMe'),
                rememberMeLabel: document.getElementById('rememberMeLabel'),
                savedBadge: document.getElementById('savedBadge')
            };

            // ── Backend wake-up helper ─────────────────────────────────────────
            // Pings both Render backends so they warm up before the user needs them.
            function wakeUpBackends() {
                fetch('https://backend-2gex.onrender.com/ping', { method: 'GET', cache: 'no-store' }).catch(function(){});
                fetch('https://backend02-4.onrender.com/ping', { method: 'GET', cache: 'no-store' }).catch(function(){});
            }

            // Storage functions for saving credentials
            function saveCredentials(role, loginId, password) {
                try {
                    const savedData = getSavedCredentials() || {};
                    savedData[role] = {
                        loginId: loginId,
                        password: btoa(password)
                    };
                    localStorage.setItem(CONFIG.storageKey, JSON.stringify(savedData));
                } catch (e) {
                    console.warn('Could not save credentials:', e);
                }
            }

            function getSavedCredentials() {
                try {
                    const data = localStorage.getItem(CONFIG.storageKey);
                    return data ? JSON.parse(data) : null;
                } catch (e) {
                    console.warn('Could not retrieve credentials:', e);
                    return null;
                }
            }

            function loadSavedCredentials(role) {
                const savedData = getSavedCredentials();
                if (savedData && savedData[role]) {
                    elements.loginId.value = savedData[role].loginId;
                    elements.password.value = atob(savedData[role].password);
                    elements.rememberMe.checked = true;
                    elements.savedBadge.classList.add('show');
                    return true;
                }
                return false;
            }

            function clearSavedCredentials(role) {
                try {
                    const savedData = getSavedCredentials();
                    if (savedData && savedData[role]) {
                        delete savedData[role];
                        localStorage.setItem(CONFIG.storageKey, JSON.stringify(savedData));
                    }
                } catch (e) {
                    console.warn('Could not clear credentials:', e);
                }
            }

            function showScreen(screenName) {
                Object.values(elements.screens).forEach(screen => {
                    screen.classList.remove('active');
                });
                
                if (elements.screens[screenName]) {
                    elements.screens[screenName].classList.add('active');
                }
            }

            function updateUIForRole(role) {
                const isZumba = role === 'zumba';
                
                // Update badge
                if (isZumba) {
                    elements.loginTypeBadge.classList.add('zumba');
                } else {
                    elements.loginTypeBadge.classList.remove('zumba');
                }
                
                // Update button
                if (isZumba) {
                    elements.loginBtn.classList.add('zumba');
                } else {
                    elements.loginBtn.classList.remove('zumba');
                }
                
                // Update remember me checkbox
                if (isZumba) {
                    elements.rememberMeLabel.classList.add('zumba');
                } else {
                    elements.rememberMeLabel.classList.remove('zumba');
                }
                
                // Update input focus styles
                if (isZumba) {
                    elements.loginId.classList.add('zumba-focus');
                    elements.password.classList.add('zumba-focus');
                } else {
                    elements.loginId.classList.remove('zumba-focus');
                    elements.password.classList.remove('zumba-focus');
                }
                
                // Update demo credentials style
                if (isZumba) {
                    elements.demoCredentials.classList.add('zumba');
                } else {
                    elements.demoCredentials.classList.remove('zumba');
                }
            }

            function handleRoleSelection(role) {
                state.currentRole = role;

                // ── CHANGED: Wake up backends for ALL roles, not just owner ──
                wakeUpBackends();

                const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);
                elements.loginTypeBadge.textContent = roleDisplay;

                // Hide demo credentials box (no hardcoded creds — Firebase is used)
                const demoBox = document.querySelector('.demo-credentials');
                if (demoBox) demoBox.style.display = 'none';

                // Update UI colors for role
                updateUIForRole(role);
                
                // Reset form
                elements.loginForm.reset();
                elements.savedBadge.classList.remove('show');
                hideError();
                
                // Try to load saved credentials for this role
                loadSavedCredentials(role);
                
                showScreen('login');
                
                setTimeout(() => {
                    elements.loginId.focus();
                }, 300);
            }

            function togglePasswordVisibility() {
                const type = elements.password.type === 'password' ? 'text' : 'password';
                elements.password.type = type;
            }

            function showError(message) {
                elements.errorMessage.textContent = message;
                elements.errorMessage.classList.add('show');
                elements.loginId.classList.add('error');
                elements.password.classList.add('error');
                
                setTimeout(() => {
                    elements.loginId.classList.remove('error');
                    elements.password.classList.remove('error');
                }, 500);
            }

            function hideError() {
                elements.errorMessage.classList.remove('show');
            }

            // ── Role-to-email mapping ──────────────────────────────────────────
            // Add or remove emails here as your user base grows.
            // Each email must appear in exactly one role list.
            const ROLE_EMAILS = {
                owner:  ['owner1@gmail.com'],
                member: ['member1@gmail.com'],
                zumba:  ['zumba1@gmail.com']
            };

            function getEmailRole(email) {
                const lower = email.toLowerCase();
                for (const [role, emails] of Object.entries(ROLE_EMAILS)) {
                    if (emails.includes(lower)) return role;
                }
                return null; // email not mapped to any role
            }

            async function handleLogin(event) {
                event.preventDefault();

                if (state.isLoading) return;

                hideError();

                const email = elements.loginId.value.trim();
                const password = elements.password.value;

                if (!email || !password) {
                    showError('Please fill in all fields.');
                    return;
                }

                const auth = window._gymAuth;
                const signIn = window._gymSignIn;

                if (!auth || !signIn) {
                    showError('Authentication service is not ready. Please refresh the page.');
                    return;
                }

                state.isLoading = true;
                elements.loginBtn.classList.add('loading');
                elements.loginBtn.disabled = true;

                try {
                    await signIn(auth, email, password);

                    // ── Role validation ──────────────────────────────────────
                    // Check if this email is mapped to a DIFFERENT role.
                    // If emailRole is null (not in map), allow through — Firebase
                    // auth itself is the only gate for unmapped accounts.
                    const emailRole = getEmailRole(email.toLowerCase());
                    const roleMismatch = emailRole !== null && emailRole !== state.currentRole;

                    if (roleMismatch) {
                        // Sign the user back out silently — wrong section
                        try {
                            const { signOut } = await import("https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js");
                            await signOut(auth);
                        } catch (e) { /* ignore signOut errors */ }
                        const label = state.currentRole.charAt(0).toUpperCase() + state.currentRole.slice(1);
                        showError('Invalid login for ' + label + ' section.');
                        state.isLoading = false;
                        elements.loginBtn.classList.remove('loading');
                        elements.loginBtn.disabled = false;
                        return;
                    }

                    // Role matches (or email not in map) — redirect
                    if (elements.rememberMe.checked) {
                        saveCredentials(state.currentRole, email, password);
                    } else {
                        clearSavedCredentials(state.currentRole);
                    }

                    const redirectUrl = CONFIG.redirects[state.currentRole];
                    if (redirectUrl) {
                        window.location.href = redirectUrl;
                    }
                } catch (error) {
                    let message = 'Login failed. Please check your credentials.';
                    if (
                        error.code === 'auth/user-not-found' ||
                        error.code === 'auth/wrong-password' ||
                        error.code === 'auth/invalid-credential'
                    ) {
                        message = 'Invalid email or password. Please try again.';
                    } else if (error.code === 'auth/invalid-email') {
                        message = 'Please enter a valid email address.';
                    } else if (error.code === 'auth/too-many-requests') {
                        message = 'Too many failed attempts. Please try again later.';
                    } else if (error.code === 'auth/network-request-failed') {
                        message = 'Network error. Please check your internet connection.';
                    }
                    showError(message);
                    state.isLoading = false;
                    elements.loginBtn.classList.remove('loading');
                    elements.loginBtn.disabled = false;
                }
            }

            function navigateToDashboard(loginId) {
                // Redirect to appropriate page based on role
                const redirectUrl = CONFIG.redirects[state.currentRole];
                if (redirectUrl) {
                    window.location.href = redirectUrl;
                }
            }

            function handleLogout() {
                state.currentRole = null;
                elements.loginForm.reset();
                elements.savedBadge.classList.remove('show');
                hideError();
                showScreen('selection');
            }

            function initEventListeners() {
                elements.selectionCards.forEach(card => {
                    card.addEventListener('click', () => {
                        const role = card.dataset.role;
                        handleRoleSelection(role);
                    });
                    
                    card.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            const role = card.dataset.role;
                            handleRoleSelection(role);
                        }
                    });
                });
                
                elements.backBtn.addEventListener('click', () => {
                    showScreen('selection');
                });
                
                elements.passwordToggle.addEventListener('click', togglePasswordVisibility);
                
                elements.loginForm.addEventListener('submit', handleLogin);
                
                elements.loginId.addEventListener('input', () => {
                    hideError();
                    elements.savedBadge.classList.remove('show');
                });
                
                elements.password.addEventListener('input', () => {
                    hideError();
                    elements.savedBadge.classList.remove('show');
                });
                
                elements.logoutBtn.addEventListener('click', handleLogout);
            }

            function init() {
                // ── CHANGED: Wake up backends immediately on page load ──
                // Render free tier cold-starts take 30–60s. Pinging here gives
                // the server maximum warm-up time before the user needs data.
                wakeUpBackends();

                initEventListeners();
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
        })();