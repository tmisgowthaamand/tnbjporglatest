const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = '/var/www/bjptn/uploads/schemes';
const PUBLIC_PATH = '/uploads/schemes';

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const extFromDataUri = (dataUri) => {
  const match = String(dataUri).match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
  if (!match) return 'png';
  const type = match[1].toLowerCase();
  if (type === 'svg+xml') return 'svg';
  if (type === 'jpeg') return 'jpg';
  return type;
};

const saveSchemeImage = async (dataUri, publicId) => {
  const ext = extFromDataUri(dataUri);
  const filename = `${publicId}.${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  const base64Data = String(dataUri).replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, '');
  fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));
  return { url: `${PUBLIC_PATH}/${filename}`, filename };
};

const deleteSchemeImage = (url) => {
  if (!url || !String(url).startsWith(PUBLIC_PATH)) return;
  const filename = path.basename(url);
  const filepath = path.join(UPLOADS_DIR, filename);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch (err) {
    console.error('[localSchemeImageService delete error]:', err.message);
  }
};

module.exports = { saveSchemeImage, deleteSchemeImage };
