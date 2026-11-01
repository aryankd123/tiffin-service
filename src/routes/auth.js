const express = require('express');
const { z } = require('zod');
const authService = require('../services/authService');
const { verifyGoogleIdToken } = require('../auth/google');

const router = express.Router();

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

// bcrypt reads only the first 72 bytes, so a longer password would be silently truncated.
// The limit is in bytes, not characters: a Hindi character is 3 bytes in UTF-8.
const password = z
  .string()
  .min(8)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'must be at most 72 bytes');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email,
  password,
});

// No length rules on login: rejecting a short password here would leak the password policy
// and differ in timing from a real check.
const loginSchema = z.object({
  email,
  password: z.string().min(1).max(1024),
});

const googleSchema = z.object({
  idToken: z.string().min(1).max(4096),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(200),
});

router.post('/register', async (req, res) => {
  const body = registerSchema.parse(req.body);
  res.status(201).json(await authService.register(body));
});

router.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);
  res.json(await authService.login(body));
});

// The frontend gets idToken from Google's sign-in button and posts it here. We verify it
// with Google's public keys, then issue our own tokens: Google proves identity, we own the session.
router.post('/google', async (req, res) => {
  const { idToken } = googleSchema.parse(req.body);
  const profile = await verifyGoogleIdToken(idToken, req.log);
  res.json(await authService.loginWithGoogle(profile));
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(await authService.refresh(refreshToken));
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logout(refreshToken);
  res.status(204).end();
});

module.exports = router;
