const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const util = require('util');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const archiver = require('archiver');
const http = require('http');
const socketIO = require('socket.io');

dotenv.config();

const app = express();
const PORT = 1500;

// Create HTTP server and Socket.IO server
const server = http.createServer(app);
const io = socketIO(server);

// Promisify fs functions for easier async/await usage
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const unlink = util.promisify(fs.unlink);
const rmdir = util.promisify(fs.rmdir);

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// Middleware to verify token
function authenticate(req, res, next) {
    const token = req.headers['x-access-token'];
    if (!token) {
        return res.status(401).send('Unauthorized: No token provided');
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send('Unauthorized: Invalid token');
        }
        req.userId = decoded.id;
        next();
    });
}

// Serve static files from the client directory
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to authenticate and get token
app.post('/login', express.json(), (req, res) => {
    const { password } = req.body;
    if (password === process.env.ACCESS_PASSWORD) {
        const token = jwt.sign({ id: 'user_id' }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token });
    } else {
        res.status(401).send('Unauthorized: Incorrect password');
    }
});

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

// Apply authentication middleware to routes that require token protection
app.use('/upload', authenticate);
app.use('/download', authenticate);
app.use('/files', authenticate);
app.use('/delete', authenticate);

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

// Endpoint to list uploaded files and their count
app.get('/files', async (req, res) => {
    try {
        const uploadDir = path.join(__dirname, 'uploads');
        const files = await getFiles(uploadDir);
        res.json({ files, count: files.length });
    } catch (error) {
        console.error('Error retrieving files:', error);
        res.status(500).send('An error occurred while retrieving files.');
    }
});

// Endpoint to download all files as a ZIP
app.get('/download-all', (req, res) => {
    const uploadDir = path.join(__dirname, 'uploads');
    let totalFiles = 0;
    let processedFiles = 0;

    fs.readdir(uploadDir, (err, folders) => {
        if (err) {
            console.error('Error reading upload directory:', err);
            res.status(500).send('An error occurred while reading the directory.');
            return;
        }

        // Calculate the total number of files to process
        folders.forEach(folder => {
            const folderPath = path.join(uploadDir, folder);
            totalFiles += fs.readdirSync(folderPath).length;
        });

        res.setHeader('Content-Disposition', 'attachment; filename=all_files.zip');
        res.setHeader('Content-Type', 'application/zip');

        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        archive.on('error', (err) => {
            throw err;
        });

        archive.on('entry', () => {
            processedFiles++;
            io.emit('zipProgress', `Zipped ${processedFiles} of ${totalFiles} files`);
        });

        archive.pipe(res);

        folders.forEach(folder => {
            const folderPath = path.join(uploadDir, folder);
            archive.directory(folderPath, folder);
        });

        archive.finalize();
    });
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

// Endpoint to delete a file
app.delete('/delete/:batch/:filename', async (req, res) => {
    const { batch, filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', batch, filename);

    try {
        await unlink(filePath);
        res.json({ message: 'File deleted successfully.' });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).send('An error occurred while deleting the file.');
    }
});

// Endpoint to delete all files
app.delete('/delete/all', async (req, res) => {
    try {
        const uploadDir = path.join(__dirname, 'uploads');
        await deleteAllFiles(uploadDir);
        res.json({ message: 'All files deleted successfully.' });
    } catch (error) {
        console.error('Error deleting all files:', error);
        res.status(500).send('An error occurred while deleting all files.');
    }
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
        if (subDir.isDirectory()) {
            return getFiles(res);
        } else if (path.basename(res) !== '.DS_Store') {
            return res;
        }
    }));
    return files.flat().filter(Boolean);
}

// Function to delete all files and directories in the given path
async function deleteAllFiles(dir) {
    const subDirs = await readdir(dir, { withFileTypes: true });
    await Promise.all(subDirs.map(async (subDir) => {
        const res = path.resolve(dir, subDir.name);
        if (subDir.isDirectory()) {
            await deleteAllFiles(res);
            await rmdir(res);
        } else {
            await unlink(res);
        }
    }));
}

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
