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

// --- Plugin-shaped JSON ---
var jsonPatches = plugin.importInvoices(load('sample-tyme.json'), profile);
assert.strictEqual(jsonPatches.length, 2, 'JSON should create 2 client invoices');
var acmeJson = findInvoice(jsonPatches, 'Acme GmbH');
assert.ok(acmeJson);
assert.strictEqual(acmeJson.items.length, 2);

// --- Public API payload ---
var apiPatches = plugin.importInvoices(load('sample-api-times.json'), profile);
assert.strictEqual(apiPatches.length, 1);
var gamma = findInvoice(apiPatches, 'Gamma Ltd');
assert.ok(gamma);
assert.strictEqual(gamma.items.length, 1);
assert.strictEqual(gamma.items[0].description, 'Retainer: Consulting');
assert.strictEqual(gamma.items[0].quantity, 2);
assert.strictEqual(gamma.items[0].unitPrice, 95);

// --- Empty / junk ---
assert.deepStrictEqual(plugin.importInvoices('', profile), []);
assert.deepStrictEqual(plugin.importInvoices('not csv and not json', profile), []);

console.log('All smoke tests passed.');
