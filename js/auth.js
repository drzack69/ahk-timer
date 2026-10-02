// Sign-in goes through the store's adapter: local accounts from config.js, or
// Firebase Authentication when team sync is configured.
import * as store from './store.js';

export const currentUser = () => store.user();
export const login = (username, password) => store.signIn(username, password);
export const logout = () => store.signOut();
