/**
 * Parse a delimited CSV string into an array of plain objects keyed by the
 * header row.
 *
 * Handles comma or semicolon delimiters (auto-detected), optional quotes,
 * and blank lines.
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

// Tyme JSON export, API `{ data: [...] }`, or a single entry object.
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

exports.looksLikeJSON = function (text) {
	var trimmed = (text || '').replace(/^\uFEFF/, '').trim();
	return trimmed.charAt(0) === '[' || trimmed.charAt(0) === '{';
};

// Avoid floating-point noise (e.g. 2.9999999 → 3).
exports.round2 = function (value) {
	return Math.round(value * 100) / 100;
};

// Case-insensitive lookup across several possible header / key names.
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

// Seconds, minutes (Tyme’s usual unit), hours, H:MM(:SS), or German decimals.
exports.durationToHours = function (raw, unitHint) {
	if (raw == null || raw === '') return 0;

	if (typeof raw === 'number' && isFinite(raw)) {
		return numericDurationToHours(raw, unitHint);
	}

	var text = String(raw).trim();
	if (!text) return 0;

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

// → YYYY-MM-DD for Billy’s service dates.
exports.toServiceDate = function (raw) {
	if (raw == null || raw === '') return '';
	var text = String(raw).trim();
	if (!text) return '';

	var iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
	if (iso) return iso[1];

	if (/^\d{10}$/.test(text)) {
		var fromUnix = new Date(parseInt(text, 10) * 1000);
		if (!isNaN(fromUnix.getTime())) return formatUTCDate(fromUnix);
	}

	if (/^\d{13}$/.test(text)) {
		var fromMs = new Date(parseInt(text, 10));
		if (!isNaN(fromMs.getTime())) return formatUTCDate(fromMs);
	}

	var euro = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
	if (euro) {
		return euro[3] + '-' + pad2(euro[2]) + '-' + pad2(euro[1]);
	}

	var parsed = new Date(text);
	if (!isNaN(parsed.getTime())) return formatUTCDate(parsed);
	return '';
};

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

	// No unit: large values look like seconds, mid-range like minutes.
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
