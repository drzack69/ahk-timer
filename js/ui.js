// Small DOM helpers: escaping, digit rendering, modal, confirm, prompt, toast.

import { icon } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Fixed-width digit cells so ticking timers never jitter, independent of the
 * font's figure set. Separators get a narrower cell.
 */
export function digits(str) {
  return [...String(str)]
    .map((ch) => (/\d/.test(ch) ? `<span class="dg">${ch}</span>` : `<span class="sep">${esc(ch)}</span>`))
    .join('');
}

export function statusOf(race) {
  switch (race.state.status) {
    case 'running':
      return { label: 'Live', cls: 'live' };
    case 'paused':
      return { label: 'Paused', cls: 'sc' };
    case 'finished':
      return { label: 'Finished', cls: 'done' };
    default:
      return { label: 'Draft', cls: 'ghost' };
  }
}

/** Set innerHTML only when it changed (keeps hover/focus and avoids layout work). */
export function setHTML(el, html) {
  if (el && el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

// ---------------------------------------------------------------- modal

let modalStack = [];

export function openModal({ title, body, footer = '', className = '', onClose } = {}) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="btn-icon ghost" data-close aria-label="Close">${icon('close')}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </div>`;
  root.appendChild(wrap);
  const prevFocus = document.activeElement;
  requestAnimationFrame(() => wrap.classList.add('open'));

  let closed = false;
  const close = (value) => {
    if (closed) return;
    closed = true;
    modalStack = modalStack.filter((m) => m !== api);
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 160);
    prevFocus?.focus?.();
    onClose?.(value);
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close(null);
  });
  const api = { el: wrap.querySelector('.modal'), close };
  modalStack.push(api);
  setTimeout(() => {
    const f = wrap.querySelector('[autofocus], input, select, textarea, button.primary');
    f?.focus?.();
    if (f?.select && f.tagName === 'INPUT') f.select();
  }, 30);
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    e.preventDefault();
    modalStack[modalStack.length - 1].close(null);
  }
});

export const modalOpen = () => modalStack.length > 0;

/** Close every open dialog (used on navigation so no dialog outlives its screen). */
export function closeAllModals() {
  [...modalStack].reverse().forEach((m) => m.close(null));
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      className: 'modal-sm',
      body: `<p class="modal-text">${message}</p>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirm)}</button>`,
      onClose: (v) => resolve(v === true),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => m.close(true));
  });
}

export function promptDialog({ title, label, value = '', confirm = 'Save' }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      className: 'modal-sm',
      body: `<label class="field"><span class="field-label">${esc(label)}</span>
               <input class="input" data-in value="${esc(value)}" maxlength="80" autofocus></label>`,
      footer: `<button class="btn ghost" data-close>Cancel</button>
               <button class="btn primary" data-ok>${esc(confirm)}</button>`,
      onClose: (v) => resolve(typeof v === 'string' ? v : null),
    });
    const input = m.el.querySelector('[data-in]');
    const ok = () => input.value.trim() && m.close(input.value.trim());
    m.el.querySelector('[data-ok]').addEventListener('click', ok);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
  });
}

// ---------------------------------------------------------------- toast

export function toast(message, type = 'info', ms = 2600) {
  const root = document.getElementById('toast-root');
  while (root.children.length >= 3) root.firstElementChild.remove();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', 'status');
  t.textContent = message;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, ms);
}
