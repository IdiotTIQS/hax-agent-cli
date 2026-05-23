/**
 * RatingSystem tests — rate, getRating, getReviews, getTopRated,
 * getUserRatings, updateReview, removeRating.
 *
 * Node.js native test runner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { RatingSystem } = require("../../src/hub/rating");

// ─── rate ────────────────────────────────────────────────────────────────

test("rate submits a valid rating", () => {
  const rs = new RatingSystem();
  const result = rs.rate("item-1", "user-a", 5, "Great!");

  assert.equal(result.userId, "user-a");
  assert.equal(result.score, 5);
  assert.equal(result.review, "Great!");
  assert.ok(typeof result.createdAt === "string", "createdAt is set");
});

test("rate defaults review to null when omitted", () => {
  const rs = new RatingSystem();
  const result = rs.rate("item-1", "user-a", 3);

  assert.equal(result.review, null);
});

test("rate clamps and rounds float scores", () => {
  const rs = new RatingSystem();
  const result = rs.rate("item-1", "user-a", 4.7);

  assert.equal(result.score, 5, "4.7 rounds to 5");
});

test("rate throws for invalid score", () => {
  const rs = new RatingSystem();

  assert.throws(() => rs.rate("item-1", "user-a", 0), { message: /between 1 and 5/ });
  assert.throws(() => rs.rate("item-1", "user-a", 6), { message: /between 1 and 5/ });
  assert.throws(() => rs.rate("item-1", "user-a", -1), { message: /between 1 and 5/ });
  assert.throws(() => rs.rate("item-1", "user-a", NaN), { message: /between 1 and 5/ });
});

test("rate throws for duplicate user rating", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 4);

  assert.throws(() => rs.rate("item-1", "user-a", 5), {
    message: /already rated/,
  });
});

test("rate throws for empty itemId or userId", () => {
  const rs = new RatingSystem();

  assert.throws(() => rs.rate("", "user-a", 3), { message: /itemId is required/ });
  assert.throws(() => rs.rate("item-1", "", 3), { message: /userId is required/ });
  assert.throws(() => rs.rate("  ", "user-a", 3), { message: /itemId is required/ });
});

// ─── getRating ───────────────────────────────────────────────────────────

test("getRating computes average and distribution", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 5);
  rs.rate("item-1", "user-b", 3);
  rs.rate("item-1", "user-c", 4);

  const rating = rs.getRating("item-1");
  assert.equal(rating.average, 4);
  assert.equal(rating.count, 3);
  assert.deepEqual(rating.distribution, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
});

test("getRating returns zeroes for unknown item", () => {
  const rs = new RatingSystem();
  const rating = rs.getRating("nonexistent");

  assert.equal(rating.average, 0);
  assert.equal(rating.count, 0);
  assert.deepEqual(rating.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
});

test("getRating handles single rating", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 2);
  const rating = rs.getRating("item-1");

  assert.equal(rating.average, 2);
  assert.equal(rating.count, 1);
  assert.deepEqual(rating.distribution, { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 });
});

test("getRating handles many ratings with precise average", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "u1", 4);
  rs.rate("item-1", "u2", 4);
  rs.rate("item-1", "u3", 5);
  // Average = 13/3 = 4.333... rounded to 4.33

  const rating = rs.getRating("item-1");
  assert.equal(rating.average, 4.33);
  assert.equal(rating.count, 3);
});

// ─── getReviews ──────────────────────────────────────────────────────────

test("getReviews returns all entries sorted newest first", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 5);
  rs.rate("item-1", "user-b", 3);

  const reviews = rs.getReviews("item-1");
  assert.equal(reviews.length, 2);
  // Newest first
  assert.equal(reviews[0].userId, "user-b");
  assert.equal(reviews[1].userId, "user-a");
});

test("getReviews supports pagination", () => {
  const rs = new RatingSystem();
  for (let i = 0; i < 5; i++) {
    rs.rate("item-1", `user-${i}`, 4);
  }

  const page1 = rs.getReviews("item-1", { limit: 2, offset: 0 });
  assert.equal(page1.length, 2);

  const page2 = rs.getReviews("item-1", { limit: 2, offset: 2 });
  assert.equal(page2.length, 2);
});

test("getReviews filters to reviewsOnly", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 5, "Amazing!");
  rs.rate("item-1", "user-b", 3, null);
  rs.rate("item-1", "user-c", 4, "Good");

  const withReviews = rs.getReviews("item-1", { reviewsOnly: true });
  assert.equal(withReviews.length, 2);
  assert.ok(withReviews.every((r) => r.review !== null));
});

test("getReviews returns empty for unknown item", () => {
  const rs = new RatingSystem();
  assert.deepEqual(rs.getReviews("nonexistent"), []);
});

// ─── getTopRated ─────────────────────────────────────────────────────────

test("getTopRated returns highest rated items", () => {
  const rs = new RatingSystem();
  // item-1: average 5
  rs.rate("item-1", "u1", 5);
  // item-2: average 3
  rs.rate("item-2", "u1", 3);
  // item-3: average 4
  rs.rate("item-3", "u1", 4);

  const top = rs.getTopRated({ limit: 3 });
  assert.equal(top.length, 3);
  assert.equal(top[0].itemId, "item-1");
  assert.equal(top[0].average, 5);
  assert.equal(top[1].itemId, "item-3");
  assert.equal(top[2].itemId, "item-2");
});

test("getTopRated respects minRatings filter", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "u1", 5);
  rs.rate("item-2", "u1", 3);
  rs.rate("item-2", "u2", 5); // item-2 has 2 ratings, avg 4

  const top = rs.getTopRated({ minRatings: 2 });
  assert.equal(top.length, 1);
  assert.equal(top[0].itemId, "item-2");
});

test("getTopRated respects limit", () => {
  const rs = new RatingSystem();
  for (let i = 0; i < 10; i++) {
    rs.rate(`item-${i}`, "u1", i % 5 + 1);
  }

  const top = rs.getTopRated({ limit: 3 });
  assert.equal(top.length, 3);
});

test("getTopRated returns empty when no ratings meet threshold", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "u1", 5);

  const top = rs.getTopRated({ minRatings: 5 });
  assert.deepEqual(top, []);
});

// ─── getUserRatings ──────────────────────────────────────────────────────

test("getUserRatings returns all ratings by a user", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 5);
  rs.rate("item-2", "user-a", 3);
  rs.rate("item-1", "user-b", 4);

  const userRatings = rs.getUserRatings("user-a");
  assert.equal(userRatings.length, 2);
  assert.equal(userRatings[0].itemId, "item-2"); // newest first
  assert.equal(userRatings[0].score, 3);
  assert.equal(userRatings[1].itemId, "item-1");
  assert.equal(userRatings[1].score, 5);
});

test("getUserRatings returns empty for unknown user", () => {
  const rs = new RatingSystem();
  assert.deepEqual(rs.getUserRatings("nobody"), []);
  assert.deepEqual(rs.getUserRatings(""), []);
});

// ─── updateReview ────────────────────────────────────────────────────────

test("updateReview modifies existing rating", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 3, "It was ok");

  const updated = rs.updateReview("item-1", "user-a", 5, "Changed my mind!");
  assert.equal(updated.score, 5);
  assert.equal(updated.review, "Changed my mind!");
  assert.ok(typeof updated.updatedAt === "string", "updatedAt is set");

  // Verify via getRating
  const rating = rs.getRating("item-1");
  assert.equal(rating.average, 5);
  assert.equal(rating.count, 1);
});

test("updateReview throws for non-existing rating", () => {
  const rs = new RatingSystem();
  assert.throws(() => rs.updateReview("item-1", "user-a", 5), {
    message: /No ratings found/,
  });

  rs.rate("item-1", "user-a", 3);
  assert.throws(() => rs.updateReview("item-1", "user-b", 5), {
    message: /No rating found for user/,
  });
});

// ─── removeRating ────────────────────────────────────────────────────────

test("removeRating deletes a user rating", () => {
  const rs = new RatingSystem();
  rs.rate("item-1", "user-a", 5);
  rs.rate("item-1", "user-b", 3);

  const removed = rs.removeRating("item-1", "user-a");
  assert.equal(removed, true);

  const rating = rs.getRating("item-1");
  assert.equal(rating.count, 1);
  assert.equal(rating.average, 3);
});

test("removeRating returns false for missing rating", () => {
  const rs = new RatingSystem();
  assert.equal(rs.removeRating("item-1", "user-a"), false);

  rs.rate("item-1", "user-a", 3);
  assert.equal(rs.removeRating("item-1", "user-b"), false);
});

// ─── totalRatings / overallAverage ───────────────────────────────────────

test("totalRatings counts across all items", () => {
  const rs = new RatingSystem();
  assert.equal(rs.totalRatings(), 0);

  rs.rate("item-1", "u1", 5);
  rs.rate("item-1", "u2", 3);
  rs.rate("item-2", "u1", 4);

  assert.equal(rs.totalRatings(), 3);
});

test("overallAverage computes global average", () => {
  const rs = new RatingSystem();
  assert.equal(rs.overallAverage(), 0);

  rs.rate("item-1", "u1", 4);
  rs.rate("item-2", "u1", 2);
  // Average = 6/2 = 3

  assert.equal(rs.overallAverage(), 3);
});

// ─── constants ───────────────────────────────────────────────────────────

test("RatingSystem exposes MIN_SCORE and MAX_SCORE constants", () => {
  assert.equal(RatingSystem.MIN_SCORE, 1);
  assert.equal(RatingSystem.MAX_SCORE, 5);
});
