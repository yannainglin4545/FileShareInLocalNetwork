const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const uploadedFilesList = document.getElementById('uploadedFilesList');
const downloadFilesList = document.getElementById('downloadFilesList');
const uploadResult = document.getElementById('uploadResult');
const reloadButton = document.getElementById('reloadButton');
const downloadAllButton = document.getElementById('downloadAllButton');
const deleteAllButton = document.getElementById('deleteAllButton');
const passwordModal = document.getElementById('passwordModal');
const passwordInput = document.getElementById('password');
const submitPasswordButton = document.getElementById('submitPassword');
const progressBar = document.getElementById('progressBar');
const progressZip = document.getElementById('progressZip');
const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const fileCount = document.getElementById('fileCount');
let selectedFiles = [];
let downloadQueue = [];
let deleteCallback;

// Initialize Socket.IO
const socket = io();

// Check for stored token
let token = localStorage.getItem('accessToken');

// Show password modal on page load if no token is stored
window.onload = function() {
    if (!token) {
        passwordModal.style.display = 'flex';
    } else {
        fetchFiles(); // Load files once token is set
    }
};

// Handle password submission
submitPasswordButton.addEventListener('click', function() {
    const password = passwordInput.value;
    fetch('/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
    })
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                throw new Error('Unauthorized: Incorrect password');
            }
        })
        .then(data => {
            token = data.token;
            localStorage.setItem('accessToken', token);
            passwordModal.style.display = 'none';
            fetchFiles(); // Load files after token is set
        })
        .catch(error => {
            showNotification(error.message, 'error');
        });
});

// Fetch files available for download
function fetchFiles() {
    fetch('/files', {
        headers: { 'x-access-token': token }
    })
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                throw new Error('Unauthorized: Invalid token');
            }
        })
        .then(data => {
            displayDownloadFiles(data.files);
            updateFileCount(data.count);
        })
        .catch(error => {
            console.error('Error fetching files:', error);
            showNotification('Unauthorized: Please enter the password again.', 'error');
            localStorage.removeItem('accessToken');
            location.reload();
        });
}

// Update file list on input change
fileInput.addEventListener('change', function () {
    const newFiles = Array.from(fileInput.files);
    selectedFiles = mergeFileLists(selectedFiles, newFiles);
    updateFileList();
    fileInput.value = ''; // Reset file input to allow re-selecting the same file
});

function mergeFileLists(existingFiles, newFiles) {
    // Filter out files that are already in the selectedFiles array
    const existingFileNames = existingFiles.map(file => file.name);
    const nonDuplicateFiles = newFiles.filter(file => !existingFileNames.includes(file.name));
    return existingFiles.concat(nonDuplicateFiles);
}

function updateFileList() {
    fileList.innerHTML = ''; // Clear previous list

    selectedFiles.forEach((file, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = file.name;

        const removeButton = document.createElement('button');
        removeButton.textContent = '×';
        removeButton.classList.add('remove-button');
        removeButton.addEventListener('click', () => removeFile(index));

        listItem.appendChild(removeButton);
        fileList.appendChild(listItem);
    });
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFileList();
}

document.getElementById('uploadForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const formData = new FormData();

    selectedFiles.forEach(file => {
        formData.append('files', file);
    });

    const xhr = new XMLHttpRequest();

    xhr.open('POST', '/upload', true);
    xhr.setRequestHeader('x-access-token', token);

    xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            progressBar.style.width = percentComplete + '%';
            progressBar.textContent = Math.round(percentComplete) + '%';
        }
    });

    xhr.onload = function () {
        if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            displayUploadedFiles(response.files);
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            fileList.innerHTML = '';
            selectedFiles = [];
            uploadResult.classList.remove('hidden'); // Show the uploaded files section
            fetchFiles(); // Refresh the files list
            showNotification('Files uploaded successfully!', 'success');
        } else {
            showNotification('An error occurred while uploading the files.', 'error');
        }
    };

    xhr.send(formData);
});

reloadButton.addEventListener('click', function () {
    location.reload(); // Reload the page to reset the form and selections
});

function displayUploadedFiles(files) {
    uploadedFilesList.innerHTML = ''; // Clear previous list
    files.forEach(fileName => {
        const listItem = document.createElement('li');
        listItem.textContent = truncateFileName(fileName);
        uploadedFilesList.appendChild(listItem);
    });
}

function displayDownloadFiles(files) {
    downloadFilesList.innerHTML = ''; // Clear previous list
    downloadQueue = files; // Keep track of all files for download
    files.forEach(filePath => {
        const fileName = filePath.split('/').pop(); // Extract file name
        const batchName = filePath.split('/').slice(-2, -1)[0]; // Extract batch name
        const listItem = document.createElement('li');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = truncateFileName(fileName);
        nameSpan.classList.add('file-name');

        const buttonGroup = document.createElement('div');
        buttonGroup.classList.add('button-group');

        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download';
        downloadButton.classList.add('download-button');
        downloadButton.addEventListener('click', () => downloadFile(batchName, fileName));

        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.classList.add('delete-button');
        deleteButton.addEventListener('click', () => deleteFile(batchName, fileName));

        buttonGroup.appendChild(downloadButton);
        buttonGroup.appendChild(deleteButton);
        listItem.appendChild(nameSpan);
        listItem.appendChild(buttonGroup);
        downloadFilesList.appendChild(listItem);
    });
}

// Listen for zip progress from the server
socket.on('zipProgress', (progressMessage) => {
    progressZip.textContent = progressMessage;
    
});

downloadAllButton.addEventListener('click', function () {
    downloadAllFiles();
});

function downloadAllFiles() {
    fetch('/download-all', {
        headers: {
            'x-access-token': token
        }
    })
        .then(response => {
            if (!response.ok) throw new Error('Failed to download ZIP file');
            return response.blob().then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'all_files.zip';
                a.click();
                URL.revokeObjectURL(url);
            });
        })
        .catch(error => {
            console.error('Error downloading ZIP file:', error);
            showNotification('An error occurred while downloading the ZIP file.', 'error');
        });
}

function truncateFileName(fileName) {
    const maxLength = 50;
    return fileName.length > maxLength ? fileName.substring(0, maxLength - 3) + '...' : fileName;
}

function downloadFile(batchName, fileName, callback) {
    fetch(`/download/${batchName}/${fileName}`, {
        headers: {
            'x-access-token': token
        }
    })
        .then(response => {
            if (!response.ok) throw new Error('Failed to download file');
            return response.blob().then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                URL.revokeObjectURL(url);
                if (callback) callback();
            });
        })
        .catch(error => {
            console.error('Error downloading file:', error);
            showNotification('An error occurred while downloading the file.', 'error');
        });
}

function deleteFile(batchName, fileName) {
    showConfirmDialog(`Are you sure you want to delete ${fileName}?`, function () {
        fetch(`/delete/${batchName}/${fileName}`, {
            method: 'DELETE',
            headers: {
                'x-access-token': token
            }
        })
            .then(response => {
                if (response.ok) {
                    showNotification('File deleted successfully.', 'success');
                    fetchFiles(); // Refresh the files list after deletion
                } else {
                    showNotification('Failed to delete file.', 'error');
                }
            })
            .catch(error => {
                console.error('Error deleting file:', error);
                showNotification('An error occurred while deleting the file.', 'error');
            });
    });
}

// Function to delete all files
deleteAllButton.addEventListener('click', function () {
    showConfirmDialog('Are you sure you want to delete all files?', function () {
        fetch('/delete/all', {
            method: 'DELETE',
            headers: {
                'x-access-token': token
            }
        })
            .then(response => {
                if (response.ok) {
                    showNotification('All files deleted successfully.', 'success');
                    fetchFiles(); // Refresh the files list after deletion
                } else {
                    showNotification('Failed to delete all files.', 'error');
                }
            })
            .catch(error => {
                console.error('Error deleting all files:', error);
                showNotification('An error occurred while deleting all files.', 'error');
            });
    });
});

// Function to update the file count display
function updateFileCount(count) {
    fileCount.textContent = `Total Files: ${count}`;
}

// Function to show the confirmation dialog
function showConfirmDialog(message, yesCallback) {
    confirmMessage.textContent = message;
    confirmModal.style.display = 'flex';
    deleteCallback = yesCallback;
}

// Add event listeners for confirmation buttons
document.getElementById('confirmYesButton').addEventListener('click', function () {
    confirmModal.style.display = 'none';
    if (deleteCallback) deleteCallback();
});

document.getElementById('confirmNoButton').addEventListener('click', function () {
    confirmModal.style.display = 'none';
    deleteCallback = null;
});

function showNotification(message, type = 'info') {
    const notificationContainer = document.getElementById('notificationContainer');

    const notification = document.createElement('div');
    notification.className = `notification ${type} show`;
    notification.textContent = message;

    notificationContainer.appendChild(notification);

    // Automatically remove the notification after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notificationContainer.removeChild(notification), 300);
    }, 5000);
}
