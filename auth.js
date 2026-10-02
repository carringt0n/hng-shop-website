const form = document.getElementById('auth-form');
let signup = false;
function mockMessage(message) {
  document.getElementById('auth-status').textContent = message;
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
form.addEventListener('submit', event => {
  event.preventDefault();
  mockMessage(signup ? 'Account creation is a preview for now.' : 'Sign-in is a preview for now.');
});
