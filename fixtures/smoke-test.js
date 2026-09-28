#!/usr/bin/env node
/**
 * Lightweight smoke test for the Tyme → Billy importer.
 * Runs with plain Node (CommonJS), no Billy host required.
 */

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var plugin = require('../main.js');

var profile = {
	vatPercentage: 19,
	hourlyRate: 100,
	currency: 'EUR',
	language: 'de',
};

function load(name) {
	return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

function findInvoice(patches, clientName) {
	return patches.find(function (patch) {
		return patch.recipient && patch.recipient.name === clientName;
	});
}

function findItem(invoice, description) {
	return invoice.items.find(function (item) {
		return item.description === description;
	});
}

function approx(actual, expected, label) {
	assert.ok(
		Math.abs(actual - expected) < 0.011,
		label + ': expected ~' + expected + ', got ' + actual
	);
}

// --- CSV ---
var csvPatches = plugin.importInvoices(load('sample-tyme.csv'), profile);
assert.strictEqual(csvPatches.length, 2, 'CSV should create 2 client invoices');

var acmeCsv = findInvoice(csvPatches, 'Acme GmbH');
assert.ok(acmeCsv, 'Acme invoice from CSV');
assert.strictEqual(acmeCsv.serviceDateStart, '2026-03-01');
assert.strictEqual(acmeCsv.serviceDateEnd, '2026-03-02');
assert.strictEqual(acmeCsv.items.length, 2, 'Acme should have Design + Development (billed row skipped)');

var design = findItem(acmeCsv, 'Website Relaunch: Design');
assert.ok(design);
assert.strictEqual(design.quantity, 3);
assert.strictEqual(design.unit, 'Hour');
assert.strictEqual(design.unitPrice, 95);
assert.strictEqual(design.vatPercentage, 19);

var development = findItem(acmeCsv, 'Website Relaunch: Development');
assert.ok(development);
assert.strictEqual(development.quantity, 4.5);

var betaCsv = findInvoice(csvPatches, 'Beta AG');
assert.ok(betaCsv);
assert.strictEqual(betaCsv.items.length, 1);
assert.strictEqual(betaCsv.items[0].quantity, 1);
assert.strictEqual(betaCsv.items[0].unitPrice, 80);

// --- Native Tyme JSON (`{ data: [...] }`, duration in minutes, rate: 0) ---
var jsonPatches = plugin.importInvoices(load('sample-tyme.json'), profile);
assert.strictEqual(jsonPatches.length, 2, 'JSON should create 2 category invoices');

var intern = findInvoice(jsonPatches, 'Entwicklung Intern');
assert.ok(intern, 'category → recipient');
assert.strictEqual(intern.serviceDateStart, '2026-09-04');
assert.strictEqual(intern.serviceDateEnd, '2026-09-05');
assert.strictEqual(intern.items.length, 2, 'billed Patientenportal row skipped');

var sysMgmt = findItem(intern, 'Entwicklung Diverses: System-Management UI/Server');
assert.ok(sysMgmt);
approx(sysMgmt.quantity, 38 / 60, 'minutes→hours');
assert.strictEqual(sysMgmt.unitPrice, 100, 'rate:0 falls back to profile hourlyRate');

var chat = findItem(intern, 'Chat System Entwicklung: Rad MUC RKR');
assert.ok(chat);
approx(chat.quantity, 105 / 60, 'chat hours');
assert.strictEqual(chat.unitPrice, 100);

var extern = findInvoice(jsonPatches, 'Kunde Extern GmbH');
assert.ok(extern);
assert.strictEqual(extern.items.length, 1);
assert.strictEqual(extern.items[0].unitPrice, 120, 'explicit positive rate wins');
approx(extern.items[0].quantity, 1.5, 'extern hours');

// --- Public API payload (seconds, *_name fields) ---
var apiPatches = plugin.importInvoices(load('sample-api-times.json'), profile);
assert.strictEqual(apiPatches.length, 1);
var gamma = findInvoice(apiPatches, 'Gamma Ltd');
assert.ok(gamma);
assert.strictEqual(gamma.items.length, 1);
assert.strictEqual(gamma.items[0].description, 'Retainer: Consulting');
assert.strictEqual(gamma.items[0].quantity, 2);
assert.strictEqual(gamma.items[0].unitPrice, 95);

// --- Real user export from Project Store (when present) ---
var realPath = '/cursor/stores/bc-b3425229-4f2e-45d7-b133-704f04df398f/artifacts/20260901-20260930.json';
if (fs.existsSync(realPath)) {
	var realPatches = plugin.importInvoices(fs.readFileSync(realPath, 'utf8'), profile);
	assert.strictEqual(realPatches.length, 1, 'real export: one category invoice');
	assert.strictEqual(realPatches[0].recipient.name, 'Entwicklung Intern');
	assert.strictEqual(realPatches[0].serviceDateStart, '2026-09-04');
	assert.strictEqual(realPatches[0].serviceDateEnd, '2026-09-25');
	assert.strictEqual(realPatches[0].items.length, 4);
	var total = realPatches[0].items.reduce(function (sum, item) {
		return sum + item.quantity;
	}, 0);
	approx(total, 17.65, 'real export total hours');
	realPatches[0].items.forEach(function (item) {
		assert.strictEqual(item.unitPrice, 100, 'real export rate:0 → profile');
		assert.strictEqual(item.unit, 'Hour');
	});
	console.log('Real export fixture check passed.');
} else {
	console.log('Real export not present; skipped store-path check.');
}

// --- Empty / junk ---
assert.deepStrictEqual(plugin.importInvoices('', profile), []);
assert.deepStrictEqual(plugin.importInvoices('not csv and not json', profile), []);

console.log('All smoke tests passed.');
