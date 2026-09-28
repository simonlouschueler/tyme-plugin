/**
 * Shared parsing helpers for Tyme CSV / JSON exports.
 *
 * Handles:
 *  - Comma or semicolon CSV (auto-detected from the header row)
 *  - Optional double-quoted fields
 *  - Blank lines
 *  - Tyme JSON array exports and API-shaped `{ data: [...] }` payloads
 */

exports.parseCSV = function (text) {
	var lines = text.split(/\r?\n/);
	if (!lines.length || !lines[0]) return [];

	var delimiter = detectDelimiter(lines[0]);
	var headers = splitLine(lines[0], delimiter).map(function (h) {
		return stripBOM(h).trim();
	});
	var rows = [];

	for (var i = 1; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line) continue;

		var values = splitLine(line, delimiter);
		var row = {};
		headers.forEach(function (header, index) {
			row[header] = (values[index] || '').trim();
		});
		rows.push(row);
	}

	return rows;
};

/**
 * Parse Tyme JSON export or Public API times payload into plain entry objects.
 * Accepts:
 *  - `[ {...}, ... ]`
 *  - `{ "data": [ {...}, ... ] }`
 *  - a single `{ ... }` entry object
 */
exports.parseJSONEntries = function (text) {
	var parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return [];
	}

	if (Array.isArray(parsed)) return parsed;
	if (parsed && Array.isArray(parsed.data)) return parsed.data;
	if (parsed && typeof parsed === 'object') return [parsed];
	return [];
};

/**
 * Detect whether raw file content looks like JSON rather than CSV.
 */
exports.looksLikeJSON = function (text) {
	var trimmed = (text || '').replace(/^\uFEFF/, '').trim();
	return trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{';
};

/**
 * Round to 2 decimal places to avoid floating-point noise.
 */
exports.round2 = function (value) {
	return Math.round(value * 100) / 100;
};

/**
 * Round to 4 decimal places (useful for fractional hours before final rounding).
 */
exports.round4 = function (value) {
	return Math.round(value * 10000) / 10000;
};

/**
 * Read a row field by trying several header aliases (case-insensitive).
 */
exports.field = function (row, aliases) {
	if (!row) return '';

	var keys = Object.keys(row);
	for (var a = 0; a < aliases.length; a++) {
		var wanted = aliases[a].toLowerCase();
		for (var k = 0; k < keys.length; k++) {
			if (keys[k].toLowerCase() === wanted) {
				var value = row[keys[k]];
				if (value == null) return '';
				return String(value).trim();
			}
		}
	}
	return '';
};

/**
 * Convert a Tyme duration value to decimal hours.
 *
 * Accepts:
 *  - number of seconds (API `duration`)
 *  - number of minutes (plugin scripting `duration` with duration_unit "m")
 *  - decimal hours
 *  - `H:MM` / `HH:MM:SS` / `H.MM` style strings
 *  - German decimal commas (`1,5`)
 */
exports.durationToHours = function (raw, unitHint) {
	if (raw == null || raw === '') return 0;

	if (typeof raw === 'number' && isFinite(raw)) {
		return numericDurationToHours(raw, unitHint);
	}

	var text = String(raw).trim();
	if (!text) return 0;

	// HH:MM(:SS)
	if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(text)) {
		var parts = text.split(':').map(function (p) {
			return parseInt(p, 10) || 0;
		});
		var hours = parts[0];
		var minutes = parts[1] || 0;
		var seconds = parts[2] || 0;
		return hours + minutes / 60 + seconds / 3600;
	}

	var normalized = text.replace(',', '.');
	var num = parseFloat(normalized);
	if (isNaN(num)) return 0;
	return numericDurationToHours(num, unitHint);
};

/**
 * Derive a calendar date `YYYY-MM-DD` from a Tyme start/date field.
 */
exports.toServiceDate = function (raw) {
	if (raw == null || raw === '') return '';
	var text = String(raw).trim();
	if (!text) return '';

	// Already ISO date or datetime
	var iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
	if (iso) return iso[1];

	// Unix seconds
	if (/^\d{10}$/.test(text)) {
		var fromUnix = new Date(parseInt(text, 10) * 1000);
		if (!isNaN(fromUnix.getTime())) return formatUTCDate(fromUnix);
	}

	// Unix milliseconds
	if (/^\d{13}$/.test(text)) {
		var fromMs = new Date(parseInt(text, 10));
		if (!isNaN(fromMs.getTime())) return formatUTCDate(fromMs);
	}

	// dd.mm.yyyy or dd/mm/yyyy
	var euro = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
	if (euro) {
		return (
			euro[3] +
			'-' +
			pad2(euro[2]) +
			'-' +
			pad2(euro[1])
		);
	}

	var parsed = new Date(text);
	if (!isNaN(parsed.getTime())) return formatUTCDate(parsed);
	return '';
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function numericDurationToHours(num, unitHint) {
	var unit = (unitHint || '').toString().trim().toLowerCase();

	if (unit === 'h' || unit === 'hour' || unit === 'hours' || unit === 'std') {
		return num;
	}
	if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
		return num / 60;
	}
	if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
		return num / 3600;
	}

	// Heuristics when no unit is given:
	// - values >= 1000 are almost certainly seconds (API style)
	// - values >= 24 and < 1000 are likely minutes
	// - otherwise treat as hours
	if (num >= 1000) return num / 3600;
	if (num >= 24) return num / 60;
	return num;
}

function detectDelimiter(headerLine) {
	var semicolons = (headerLine.match(/;/g) || []).length;
	var commas = (headerLine.match(/,/g) || []).length;
	return commas > semicolons ? ',' : ';';
}

function splitLine(line, delimiter) {
	var fields = [];
	var current = '';
	var inQuotes = false;

	for (var i = 0; i < line.length; i++) {
		var ch = line[i];

		if (ch === '"') {
			inQuotes = !inQuotes;
		} else if (ch === delimiter && !inQuotes) {
			fields.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

function stripBOM(value) {
	return value.replace(/^\uFEFF/, '');
}

function pad2(value) {
	var s = String(value);
	return s.length === 1 ? '0' + s : s;
}

function formatUTCDate(date) {
	return (
		date.getUTCFullYear() +
		'-' +
		pad2(date.getUTCMonth() + 1) +
		'-' +
		pad2(date.getUTCDate())
	);
}
