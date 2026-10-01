import { login } from '../auth.js';
import { icon, logo } from '../icons.js';

export function LoginView({ view, go }) {
  view.innerHTML = `
    <div class="login">
      <div class="login-card">
        ${logo()}
        <p class="tagline">Endurance stint control</p>
        <form novalidate>
          <label class="field">
            <span class="field-label">Username</span>
            <span class="input-icon">${icon('user')}
              <input class="input" name="u" autocomplete="username" autocapitalize="none" spellcheck="false" required>
            </span>
          </label>
          <label class="field">
            <span class="field-label">Password</span>
            <span class="input-icon">${icon('lock')}
              <input class="input" name="p" type="password" autocomplete="current-password" required>
            </span>
          </label>
          <div class="login-error" role="alert"></div>
          <button class="btn primary" type="submit">Sign in</button>
        </form>
      </div>
    </div>`;

  const form = view.querySelector('form');
  const err = view.querySelector('.login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    const ok = await login(form.u.value, form.p.value);
    btn.disabled = false;
    if (ok) go('#/races');
    else {
      err.textContent = 'Wrong username or password.';
      form.p.select();
    }
  });
  setTimeout(() => form.u.focus(), 50);
}
