const form = document.getElementById('auth-form');
const status = document.getElementById('auth-status');
const googleButton = document.getElementById('google-signin');
let signup = false;

function mockMessage(message) {
  status.textContent = message;
}

function toggleSignup(enabled) {
  signup = enabled;
  document.getElementById('auth-heading').textContent = signup ? 'A lovely place to start.' : 'Come on in.';
  document.getElementById('auth-intro').textContent = signup
    ? 'Create an account to save favourites and follow your orders.'
    : 'Sign in to save your favourites and keep track of your orders.';
  document.getElementById('submit-label').textContent = signup ? 'CREATE ACCOUNT' : 'SIGN IN';
  document.getElementById('auth-switch').innerHTML = signup
    ? 'Already have an account? <button class="textbutton" type="button" onclick="toggleSignup(false)">Sign in</button>'
    : 'New to Forma? <button class="textbutton" type="button" onclick="toggleSignup(true)">Create an account</button>';
  mockMessage('');
}

googleButton.addEventListener('click', () => window.location.assign('/auth/google'));
form.addEventListener('submit', event => {
  event.preventDefault();
  mockMessage(signup ? 'Email account creation is a preview for now.' : 'Email sign-in is a preview for now.');
});

async function showSession() {
  const query = new URLSearchParams(window.location.search);
  if (query.has('auth_error')) {
    const messages = {
      cancelled: 'Google sign-in was cancelled.',
      state: 'Sign-in expired. Please try again.',
      google: 'Google sign-in could not be completed. Please try again.',
    };
    mockMessage(messages[query.get('auth_error')] || messages.google);
  }

  try {
    const response = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    if (!result.authenticated) return;
    const user = result.user;
    document.getElementById('auth-heading').textContent = `Welcome${user.name ? `, ${user.name}` : ' back'}.`;
    document.getElementById('auth-intro').textContent = `You are signed in as ${user.email}.`;
    googleButton.hidden = true;
    document.querySelector('.auth-divider').hidden = true;
    form.hidden = true;
    document.getElementById('auth-switch').hidden = true;
    status.textContent = 'Your Forma sign-in is ready.';
    const signOut = document.createElement('button');
    signOut.className = 'primary';
    signOut.type = 'button';
    signOut.textContent = 'SIGN OUT';
    signOut.style.width = '100%';
    signOut.style.marginTop = '14px';
    signOut.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.assign('/login.html');
    });
    status.after(signOut);
  } catch {
    mockMessage('Start the shop server to use Google sign-in.');
  }
}

showSession();
