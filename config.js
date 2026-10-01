// AHK Timer — login accounts.
//
// Passwords are stored as SHA-256 hashes. To add a user or change a password,
// hash it in a terminal and paste the result below:
//
//   printf '%s' 'new-password' | shasum -a 256
//
// The default account is listed in README.md — change it before publishing.
// Note: this is a static site, so the login is a lightweight gate in front of
// the UI, not server-side security (see README → Login).

export const USERS = [
  { username: 'ahk', passwordSha256: 'c5f1d3d03ffcc0e9fddb9ef0c6ddc1a198997ea57abd42332d265489264e1a6c' },
];
