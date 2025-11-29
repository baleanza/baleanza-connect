const { escapeXml, isBooleanLike, booleanToUa, convertLengthToCm, convertWeightToKg } = require('./helpers');

const CORE_TAGS = ['id','code','vendor_code','title','barcode','category','category_id','brand','availability','weight','height','width','length','description'];
const IMAGE_PREFIX = 'image_';

function buildControlMap(controlValues) {
  const map = {};
  if (!controlValues || controlValues.length === 0) return map;
  // header row exists
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
  if (units) valStr = valStr.replace(/,/g, '.') + ' ' + units;
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
    if (row.join('') === '') return;
    const offerLines = [];
    let codeLine = '';
    let titleLine = '';
    let idLine = '';
    let vendorLine = '';
    const pictureLines = [];
    const paramLines = [];

    headers.forEach((header, colIndex) => {
      if (!header) return;
      const value = row[colIndex];
      if (value === '' || value === null || value === undefined) return;
      const control = controlMap[header];
      if (!control || !control.enabled) return;
      const xmlName = control.xmlName;
      const units = control.units;

      if (CORE_TAGS.includes(xmlName)) {
        let coreValue = value;
        if (xmlName === 'description') {
          offerLines.push('      <description><![CDATA[' + String(coreValue) + ']]></description>');
          return;
        }
        if (['height','width','length'].includes(xmlName)) {
          coreValue = convertLengthToCm(coreValue, units);
        }
        if (xmlName === 'weight') {
          coreValue = convertWeightToKg(coreValue, units);
        }
        if (xmlName === 'code') { codeLine = '      <code>' + escapeXml(coreValue) + '</code>'; return; }
        if (xmlName === 'title') { titleLine = '      <title>' + escapeXml(coreValue) + '</title>'; return; }
        if (xmlName === 'id') { idLine = '      <id>' + escapeXml(coreValue) + '</id>'; return; }
        if (xmlName === 'vendor_code') { vendorLine = '      <vendor_code>' + escapeXml(coreValue) + '</vendor_code>'; return; }
        offerLines.push('      <' + xmlName + '>' + escapeXml(coreValue) + '</' + xmlName + '>');
        return;
      }

      if (String(xmlName).indexOf(IMAGE_PREFIX) === 0) {
        pictureLines.push('        <picture>' + escapeXml(value) + '</picture>');
        return;
      }

      if (xmlName === 'tags') {
        const paramName = header; // use import header as param name
        const processed = processTagParamValue(paramName, value, units);
        processed.forEach(item => paramLines.push('        <param name="' + escapeXml(paramName) + '">' + escapeXml(item) + '</param>'));
        return;
      }

      // default param
      let valStr = String(value);
      if (units) valStr = valStr.replace(/,/g, '.') + ' ' + units;
      if (valStr === '') return;
      paramLines.push('        <param name="' + escapeXml(xmlName) + '">' + escapeXml(valStr) + '</param>');
    });

    if (!codeLine && !titleLine && !idLine && !vendorLine && offerLines.length===0 && pictureLines.length===0 && paramLines.length===0) return;

    xml.push('    <offer
