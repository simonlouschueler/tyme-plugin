var helpers = require('./helpers.js');

/**
 * Import Tyme time entries as Billy invoice patches.
 *
 * One invoice per Tyme category (client), one Hour line item per task
 * (project-prefixed when useful). Matches the Timemator / Toggl Track pattern.
 */
exports.importInvoices = function (fileContent, profile) {
	var entries = loadEntries(fileContent);
	if (!entries.length) return [];

	var vatPercentage =
		profile && typeof profile.vatPercentage === 'number'
			? profile.vatPercentage
			: 0;

	var fallbackRate =
		profile && typeof profile.hourlyRate === 'number'
			? profile.hourlyRate
			: 0;

	var normalizedEntries = [];
	entries.forEach(function (entry) {
		var normalized = normalizeEntry(entry);
		if (!normalized) return;
		if (normalized.explicitlyNonBillable) return;
		normalizedEntries.push(normalized);
	});

	if (!normalizedEntries.length) return [];

	// Prefer still-unbilled rows when the export marks billing state.
	// If every row is already billed/paid, fall back to importing all of them
	// (same idea as the Toggl Track plugin’s billable filter).
	var hasUnbilled = normalizedEntries.some(function (entry) {
		return !entry.explicitlyBilledOrPaid;
	});
	if (hasUnbilled) {
		normalizedEntries = normalizedEntries.filter(function (entry) {
			return !entry.explicitlyBilledOrPaid;
		});
	}

	var clients = {};

	normalizedEntries.forEach(function (normalized) {
		var clientKey = normalized.client;
		if (!clients[clientKey]) {
			clients[clientKey] = { tasks: {}, dates: [] };
		}
		var group = clients[clientKey];

		if (normalized.date) group.dates.push(normalized.date);

		if (!group.tasks[normalized.taskKey]) {
			group.tasks[normalized.taskKey] = {
				description: normalized.description,
				totalHours: 0,
				totalRevenue: 0,
				hourlyRate: normalized.hourlyRate,
				hasRate: isPositive(normalized.hourlyRate),
			};
		}

		var task = group.tasks[normalized.taskKey];
		task.totalHours += normalized.hours;
		if (isPositive(normalized.revenue)) {
			task.totalRevenue += normalized.revenue;
		}
		if (!task.hasRate && isPositive(normalized.hourlyRate)) {
			task.hourlyRate = normalized.hourlyRate;
			task.hasRate = true;
		}
	});

	return Object.keys(clients)
		.sort()
		.map(function (clientKey) {
			return buildInvoice(clientKey, clients[clientKey], {
				vatPercentage: vatPercentage,
				fallbackRate: fallbackRate,
			});
		})
		.filter(function (patch) {
			return patch.items && patch.items.length > 0;
		});
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function loadEntries(fileContent) {
	if (!fileContent || !String(fileContent).trim()) return [];

	if (helpers.looksLikeJSON(fileContent)) {
		return helpers.parseJSONEntries(fileContent);
	}

	return helpers.parseCSV(fileContent);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

var CLIENT_ALIASES = [
	'category',
	'category_name',
	'Kategorie',
	'client',
	'Client',
	'Kunde',
	'folder',
];

var PROJECT_ALIASES = ['project', 'project_name', 'Projekt'];

var TASK_ALIASES = ['task', 'task_name', 'Aufgabe', 'TimedTask'];

var SUBTASK_ALIASES = ['subtask', 'subtask_name', 'Unteraufgabe'];

var DURATION_ALIASES = [
	'duration',
	'duration_rounded',
	'duration_decimal',
	'amount_decimal',
	'amount',
	'Dauer',
	'Stunden',
	'hours',
	'Hours',
];

var DURATION_UNIT_ALIASES = ['duration_unit', 'Dauer Einheit', 'unit'];

var RATE_ALIASES = [
	'rate',
	'hourly_rate',
	'default_hourly_rate',
	'Stundensatz',
	'Hourly rate',
];

var REVENUE_ALIASES = [
	'revenue',
	'sum',
	'Betrag',
	'Amount',
	'Amount (EUR)',
	'Amount (USD)',
];

var START_ALIASES = [
	'start',
	'time_start',
	'date',
	'Date',
	'Datum',
	'Start date',
	'Start',
];

var END_ALIASES = ['end', 'time_end', 'Stop date', 'Ende'];

var BILLING_ALIASES = ['billing', 'billing_state', 'Abrechnung', 'Billable'];

var TYPE_ALIASES = ['type', 'Type', 'Typ'];

var NOTE_ALIASES = ['note', 'Notiz', 'Notes', 'Comment'];

function normalizeEntry(entry) {
	if (!entry || typeof entry !== 'object') return null;

	// Skip non-time rows from mixed Tyme exports / API sync payloads.
	var type = helpers.field(entry, TYPE_ALIASES);
	if (type) {
		var lowerType = type.toLowerCase();
		if (
			lowerType !== 'timed' &&
			lowerType !== 'timedtaskrecord' &&
			lowerType !== 'time' &&
			lowerType.indexOf('timed') === -1
		) {
			// Keep CSV rows without a meaningful type filter; only skip clear non-time types.
			if (
				lowerType === 'mileage' ||
				lowerType === 'expense' ||
				lowerType === 'fixed' ||
				lowerType === 'project' ||
				lowerType === 'projectcategory' ||
				lowerType === 'timedtask' ||
				lowerType === 'nonworkingrecord'
			) {
				return null;
			}
		}
	}

	var project = helpers.field(entry, PROJECT_ALIASES);
	var task = helpers.field(entry, TASK_ALIASES);
	var subtask = helpers.field(entry, SUBTASK_ALIASES);
	var client = helpers.field(entry, CLIENT_ALIASES);

	if (!task && !project) return null;

	var unitHint = helpers.field(entry, DURATION_UNIT_ALIASES);
	var durationRaw = firstPresent(entry, DURATION_ALIASES);
	var hours = helpers.durationToHours(durationRaw, unitHint);
	if (!(hours > 0)) return null;

	var startRaw = firstPresent(entry, START_ALIASES);
	var endRaw = firstPresent(entry, END_ALIASES);
	var date = helpers.toServiceDate(startRaw) || helpers.toServiceDate(endRaw);

	var rateRaw = firstPresent(entry, RATE_ALIASES);
	// Tyme’s native JSON often ships `rate: 0` / `sum: 0` when no price is set.
	// Treat non-positive values as missing so the Billy profile rate can apply.
	var hourlyRate = positiveNumber(parseLocaleNumber(rateRaw));

	var revenueRaw = firstPresent(entry, REVENUE_ALIASES);
	var revenue = positiveNumber(parseLocaleNumber(revenueRaw));

	// Derive rate from revenue when the export has a positive sum but no rate.
	if (isNaN(hourlyRate) && !isNaN(revenue) && hours > 0) {
		hourlyRate = revenue / hours;
	}

	var description = buildDescription(project, task, subtask);
	var taskKey = description;
	var billing = helpers.field(entry, BILLING_ALIASES);

	return {
		client: client || '',
		description: description,
		taskKey: taskKey,
		hours: hours,
		hourlyRate: hourlyRate,
		revenue: revenue,
		date: date,
		note: helpers.field(entry, NOTE_ALIASES),
		explicitlyNonBillable: isNonBillable(billing),
		explicitlyBilledOrPaid: isBilledOrPaid(billing),
	};
}

function buildDescription(project, task, subtask) {
	var parts = [];
	if (project && task && project !== task) {
		parts.push(project);
		parts.push(task);
	} else if (task) {
		parts.push(task);
	} else if (project) {
		parts.push(project);
	}
	if (subtask) parts.push(subtask);
	return parts.join(': ');
}

function buildInvoice(clientKey, group, options) {
	group.dates.sort();

	var items = Object.keys(group.tasks)
		.sort()
		.map(function (taskKey) {
			var t = group.tasks[taskKey];
			var hours = helpers.round2(t.totalHours);
			if (!(hours > 0)) return null;

			var unitPrice = options.fallbackRate;
			if (t.hasRate && isPositive(t.hourlyRate)) {
				unitPrice = helpers.round2(t.hourlyRate);
			} else if (t.totalRevenue > 0 && t.totalHours > 0) {
				unitPrice = helpers.round2(t.totalRevenue / t.totalHours);
			}

			return {
				description: t.description,
				quantity: hours,
				unit: 'Hour',
				unitPrice: unitPrice,
				vatPercentage: options.vatPercentage,
			};
		})
		.filter(Boolean);

	var patch = {
		recipient: { name: clientKey },
		items: items,
	};

	if (group.dates.length) {
		patch.serviceDateStart = group.dates[0];
		var lastDate = group.dates[group.dates.length - 1];
		if (lastDate !== group.dates[0]) {
			patch.serviceDateEnd = lastDate;
		}
	}

	return patch;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function firstPresent(row, aliases) {
	// Prefer helpers.field for string lookup, but also accept bare property access
	// for JSON objects that use the canonical Tyme keys.
	var fromAlias = helpers.field(row, aliases);
	if (fromAlias !== '') return fromAlias;

	for (var i = 0; i < aliases.length; i++) {
		if (Object.prototype.hasOwnProperty.call(row, aliases[i])) {
			var value = row[aliases[i]];
			if (value != null && value !== '') return value;
		}
	}
	return '';
}

function parseLocaleNumber(raw) {
	if (raw == null || raw === '') return NaN;
	if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
	var text = String(raw).trim();
	if (!text) return NaN;
	// Keep the last separator as decimal if both . and , appear.
	if (text.indexOf(',') >= 0 && text.indexOf('.') >= 0) {
		if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
			text = text.replace(/\./g, '').replace(',', '.');
		} else {
			text = text.replace(/,/g, '');
		}
	} else {
		text = text.replace(',', '.');
	}
	text = text.replace(/[^\d.-]/g, '');
	var num = parseFloat(text);
	return isNaN(num) ? NaN : num;
}

/** Finite number strictly greater than zero (Tyme uses 0 as “unset”). */
function isPositive(value) {
	return typeof value === 'number' && isFinite(value) && value > 0;
}

function positiveNumber(value) {
	return isPositive(value) ? value : NaN;
}

function isNonBillable(billing) {
	if (billing == null || billing === '') return false;
	var text = String(billing).trim().toLowerCase();
	return (
		text === 'no' ||
		text === 'false' ||
		text === 'non-billable' ||
		text === 'nonbillable' ||
		text === 'nicht abrechenbar' ||
		text === 'unbillable'
	);
}

function isBilledOrPaid(billing) {
	if (billing == null || billing === '') return false;
	var text = String(billing).trim().toLowerCase();
	if (text === '1' || text === '2') return true;
	return (
		text === 'billed' ||
		text === 'paid' ||
		text === 'abgerechnet' ||
		text === 'bezahlt'
	);
}
