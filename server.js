const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const util = require('util');

const app = express();
const PORT = 1500;

// Promisify fs functions for easier async/await usage
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);

// Multer storage configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const batchDir = path.join(__dirname, 'uploads', getBatchDirName(req));
    await mkdir(batchDir, { recursive: true });
    cb(null, batchDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

// Initialize upload for multiple files
const upload = multer({ storage: storage });

// Serve static files
app.use(express.static('public'));

// Upload endpoint for multiple files
app.post('/upload', upload.array('files', 100), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No files uploaded.');
  }

  try {
    const uploadedFiles = req.files.map(file => file.originalname);
    res.json({ message: 'Files uploaded successfully.', files: uploadedFiles });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).send('An error occurred while uploading files.');
  }
});

// Endpoint to list uploaded files
app.get('/files', async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, 'uploads');
    const files = await getFiles(uploadDir);
    res.json({ files });
  } catch (error) {
    console.error('Error retrieving files:', error);
    res.status(500).send('An error occurred while retrieving files.');
  }
});

// Endpoint to download a file
app.get('/download/:batch/:filename', (req, res) => {
  const { batch, filename } = req.params;
  const filePath = path.join(__dirname, 'uploads', batch, filename);

  res.download(filePath, err => {
    if (err) {
      console.error('Error downloading file:', err);
      res.status(500).send('An error occurred while downloading the file.');
    }
  });
});

// Function to generate a batch directory name based on the current timestamp
function getBatchDirName(req) {
  if (!req.batchDirName) {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:.TZ]/g, '');
    req.batchDirName = `batch_${timestamp}`;
  }
  return req.batchDirName;
}

// Function to get all files from a directory
async function getFiles(dir) {
  const subDirs = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(subDirs.map(async (subDir) => {
    const res = path.resolve(dir, subDir.name);
    return subDir.isDirectory() ? getFiles(res) : res;
  }));
  return files.flat();
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
