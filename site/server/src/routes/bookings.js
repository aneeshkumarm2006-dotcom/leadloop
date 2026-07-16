/**
 * bookings.js — Visit Booking routers (Phase 4b). Mirrors forms.js: a public
 * unauthenticated router (`/book/...`) mounted before the global body parser +
 * auth, and an authed admin/board-scoped router.
 */
const express = require('express');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const {
  listBookingLinks,
  createBookingLink,
  getBookingLink,
  updateBookingLink,
  deleteBookingLink,
  listBookingsForLink,
  renderBookingPublic,
  getPublicSlots,
  submitBooking,
  getBookingIcs,
  cancelBooking,
} = require('../controllers/bookingController');

const ipKey = (req) => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';

// --- Public booking router (NO auth) ---------------------------------------
const publicBookingRouter = express.Router();
publicBookingRouter.get('/book/ics/:token', getBookingIcs);
publicBookingRouter.get('/book/:slug', renderBookingPublic);
publicBookingRouter.get('/book/:slug/slots', getPublicSlots);
publicBookingRouter.post(
  '/book/:slug/submit',
  rateLimit({ keyFn: (req) => `booking:${req.params.slug}:${ipKey(req)}` }),
  express.json({ limit: '256kb' }),
  submitBooking
);
publicBookingRouter.post(
  '/book/:slug/cancel/:token',
  rateLimit({ keyFn: (req) => `bookingcancel:${req.params.slug}:${ipKey(req)}` }),
  express.json({ limit: '16kb' }),
  cancelBooking
);

// --- Admin board-scoped router (auth required) -----------------------------
const boardBookingRouter = express.Router();
boardBookingRouter.use(authMiddleware);
boardBookingRouter.get('/boards/:id/booking-links', listBookingLinks);
boardBookingRouter.post('/boards/:id/booking-links', createBookingLink);
boardBookingRouter.get('/booking-links/:id', getBookingLink);
boardBookingRouter.patch('/booking-links/:id', updateBookingLink);
boardBookingRouter.delete('/booking-links/:id', deleteBookingLink);
boardBookingRouter.get('/booking-links/:id/bookings', listBookingsForLink);

module.exports = { publicBookingRouter, boardBookingRouter };
