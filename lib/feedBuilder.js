const {
  escapeXml,
  isBooleanLike,
  booleanToUa,
  normalizeDecimalWithUnit,
  convertLengthToCm,
  convertWeightToKg
} = require('./helpers');

const CORE_TAGS = ['id','code','vendor_code','title','barcode','category','category_id','brand','availability','weight','height','width','length','description'];
const IMAGE_PREFIX = 'image_';

function buildControlMap(controlValues) {
  const map = {};
  if (!controlValues || controlValues.length === 0) return map;
  for (let i = 1; i < controlValues.length; i++) {
    const row = controlValues[i];
    const importField = row[0];
    if (!importField) continue;
    const flag = row[1];
    const feedName = row[2] ? String(row[2]).trim() : String(importField).trim();
    const units = row[3] ? String(row[3]).trim() : '';
    const enabled = (flag === true) || (String(flag || '').toLowerCase() === 'true') || (String(flag||'') === '1');
    map[String(importField).trim()] = { enabled, xmlName: feedName, units };
  }
  return map;
}

function processTagParamValue(paramName, value, units) {
  if (value === null || value === undefined) return [];
  if (String(value).trim().toLowerCase() === 'cellimage') return [];
  if (isBooleanLike(value)) {
    const s = booleanToUa(value);
    return s ? [s] : [];
  }
  let valStr = String(value).trim();
  if (!valStr) return [];
  // replace comma with dot only if units exists (as requested)
  if (units) valStr = valStr.replace(/,/g, '.');
  if (units && units.length) valStr = valStr + ' ' + units;
  if (paramName === 'Особливості') {
    return valStr.split(',').map(p => p.trim()).filter(Boolean);
  }
  return [valStr];
}

function buildOffersXml(importValues, controlMap) {
  if (!importValues || importValues.length < 2) return `<?xml version='1.0' encoding='UTF-8'?><Market><offers/></Market>`;
  const headers = importValues[0].map(h => h ? String(h).trim() : '');
  const rows = importValues.slice(1);
  const xml = [];
  xml.push("<?xml version='1.0' encoding='UTF-8'?>");
  xml.push('<Market>');
  xml.push('  <offers>');

  rows.forEach(row => {
    // skip fully empty rows
    if (row.join('') === '') return;

    const offerLines = [];
    let codeLine = '';
    let titleLine = '';
    let idLine = '';
    let vendorLine = '';
    const pictureLines = [];
    const paramLines = [];

    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const header = headers[colIndex];
      if (!header) continue;
      const value = row[colIndex];
      if (value === '' || value === null || value === undefined) continue;
      const control = controlMap[header];
      if (!control || !control.enabled) continue;
      const xmlName = control.xmlName;
      const units = control.units;

      // core tags handling
      if (CORE_TAGS.includes(xmlName)) {
        let coreValue = value;

        // description -> CDATA
        if (xmlName === 'description') {
          offerLines.push('      <description><![CDATA[' + String(coreValue) + ']]></description>');
          continue;
        }

        // numeric conversions for length/weight
        if (['height','width','length'].includes(xmlName)) {
          coreValue = convertLengthToCm(coreValue, units);
        }
        if (xmlName === 'weight') {
          coreValue = convertWeightToKg(coreValue, units);
        }

        if (xmlName === 'code') { codeLine = '      <code>' + escapeXml(coreValue) + '</code>'; continue; }
        if (xmlName === 'title') { titleLine = '      <title>' + escapeXml(coreValue) + '</title>'; continue; }
        if (xmlName === 'id') { idLine = '      <id>' + escapeXml(coreValue) + '</id>'; continue; }
        if (xmlName === 'vendor_code') { vendorLine = '      <vendor_code>' + escapeXml(coreValue) + '</vendor_code>'; continue; }

        offerLines.push('      <' + xmlName + '>' + escapeXml(coreValue) + '</' + xmlName + '>');
        continue;
      }

      // images
      if (String(xmlName).indexOf(IMAGE_PREFIX) === 0) {
        pictureLines.push('        <picture>' + escapeXml(value) + '</picture>');
        continue;
      }

      // tags handling
      if (xmlName === 'tags') {
        const paramName = header;
        const processed = processTagParamValue(paramName, value, units);
        processed.forEach(item => paramLines.push('        <param name="' + escapeXml(paramName) + '">' + escapeXml(item) + '</param>'));
        continue;
      }

      // default: other params (xmlName used as name)
      let valStr = String(value);
      if (units) valStr = valStr.replace(/,/g, '.') + ' ' + units;
      if (valStr === '') continue;
      paramLines.push('        <param name="' + escapeXml(xmlName) + '">' + escapeXml(valStr) + '</param>');
    } // end headers loop

    // skip if nothing collected
    if (!codeLine && !titleLine && !idLine && !vendorLine && offerLines.length === 0 && pictureLines.length === 0 && paramLines.length === 0) return;

    xml.push('    <offer>');
    // required order: code, title, id, vendor_code
    if (codeLine) xml.push(codeLine);
    if (titleLine) xml.push(titleLine);
    if (idLine) xml.push(idLine);
    if (vendorLine) xml.push(vendorLine);

    // other core tags
    offerLines.forEach(l => xml.push(l));

    // images
    if (pictureLines.length > 0) {
      xml.push('      <image_link>');
      pictureLines.forEach(p => xml.push(p));
      xml.push('      </image_link>');
    }

    // tags
    if (paramLines.length > 0) {
      xml.push('      <tags>');
      paramLines.forEach(p => xml.push(p));
      xml.push('      </tags>');
    }

    xml.push('    </offer>');
  });

  xml.push('  </offers>');
  xml.push('</Market>');
  return xml.join('\n');
}

module.exports = { buildControlMap, buildOffersXml, processTagParamValue };
