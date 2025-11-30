const { google } = require('googleapis');
const { getJwtClient } = require('./jwtAuth');

async function getDrive() {
  const auth = getJwtClient();
  await auth.authorize();
  return google.drive({ version: 'v3', auth });
}

async function findFileByName(drive, name) {
  const q = `name='${String(name).replace(/'/g, "\\'")}' and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id,name,modifiedTime)',
    spaces: 'drive'
  });
  return (res.data.files && res.data.files[0]) || null;
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', (err) => reject(err));
  });
}

async function readFileContent(drive, fileId) {
  // returns string content
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  const stream = res.data;
  const text = await streamToString(stream);
  return text;
}

async function uploadOrUpdateFile(drive, name, content) {
  // Try to find existing
  const existing = await findFileByName(drive, name);

  const media = {
    mimeType: 'application/xml',
    body: content
  };

  if (existing) {
    await drive.files.update({
      fileId: existing.id,
      media,
    });
    // refresh metadata
    const updated = await drive.files.get({ fileId: existing.id, fields: 'id,name,modifiedTime' });
    return updated.data;
  } else {
    const res = await drive.files.create({
      requestBody: { name, mimeType: 'application/xml' },
      media,
      fields: 'id,name,modifiedTime'
    });
    return res.data;
  }
}

module.exports = { getDrive, findFileByName, readFileContent, uploadOrUpdateFile };
