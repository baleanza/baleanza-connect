export function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function isBooleanLike(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  if (!v) return false;
  const trueSet = ['true', '1', 'так', 'yes', 'y', 'да'];
  const falseSet = ['false', '0', 'ні', 'no', 'n', 'нет'];
  return trueSet.includes(v) || falseSet.includes(v);
}

export function booleanToUa(value) {
  if (!isBooleanLike(value)) return String(value);
  const v = String(value).trim().toLowerCase();
  const trueSet = ['true', '1', 'так', 'yes', 'y', 'да'];
  return trueSet.includes(v) ? 'Так' : 'Ні';
}

export function convertUnits(fieldName, rawValue, units) {
  if (rawValue == null || rawValue === '') return null;
  if (!units) return rawValue;

  let v = String(rawValue);
  v = v.replace(/,/g, '.');
  const num = parseFloat(v);
  if (Number.isNaN(num)) return null;

  const lengthFields = ['height', 'width', 'length'];
  const weightField = 'weight';

  let result = num;

  if (lengthFields.includes(fieldName)) {
    switch (units) {
      case 'мм':
        result = num / 10;
        break;
      case 'см':
        result = num;
        break;
      case 'м':
        result = num * 100;
        break;
      default:
        return null;
    }
  } else if (fieldName === weightField) {
    switch (units) {
      case 'г':
        result = num / 1000;
        break;
      case 'кг':
        result = num;
        break;
      default:
        return null;
    }
  } else {
    return `${v} ${units}`;
  }

  return Number(result.toFixed(2));
}

export function normalizeBooleanOrString(value) {
  if (isBooleanLike(value)) {
    return booleanToUa(value);
  }
  return String(value);
}

export function processTagParamValue(paramName, rawValue) {
  if (rawValue == null || rawValue === '') return [];

  if (paramName === 'Особливості') {
    const parts = String(rawValue)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.map((p) => ({
      name: paramName,
      value: normalizeBooleanOrString(p)
    }));
  }

  return [
    {
      name: paramName,
      value: normalizeBooleanOrString(rawValue)
    }
  ];
}
