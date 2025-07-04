const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// AWS S3 Configuration
// The SDK will automatically use the IAM role attached to the EC2 instance
const s3 = new AWS.S3({
    region: process.env.AWS_REGION || 'us-east-1'
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'your-bucket-name';

// Configure multer for file uploads
// This creates a temporary storage location for uploaded files
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Store files temporarily in uploads directory
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Generate unique filename with timestamp and random string
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, 'img_' + uniqueSuffix + extension);
    }
});

// File filter to only allow image uploads
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }
};

// Configure multer with size limits and file filtering
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: fileFilter
});

// Serve the main upload page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint (important for load balancer)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Handle image upload
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const localFilePath = req.file.path;
        const fileName = req.file.filename;
        const s3Key = `images/${fileName}`;

        // Read the file from local storage
        const fileContent = fs.readFileSync(localFilePath);

        // Upload parameters for S3
        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fileContent,
            ContentType: req.file.mimetype,
            // Make the file publicly readable
            ACL: 'public-read'
        };

        // Upload to S3
        const result = await s3.upload(uploadParams).promise();

        // Clean up local file after successful upload
        fs.unlinkSync(localFilePath);

        // Return success response with image URL
        res.json({
            success: true,
            message: 'Image uploaded successfully',
            imageUrl: result.Location,
            fileName: fileName
        });

    } catch (error) {
        console.error('Upload error:', error);
        
        // Clean up local file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: 'Upload failed',
            message: error.message
        });
    }
});

// Get list of uploaded images (optional feature)
app.get('/images', async (req, res) => {
    try {
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: 'images/',
            MaxKeys: 50 // Limit to 50 most recent images
        };

        const data = await s3.listObjectsV2(params).promise();
        
        const images = data.Contents.map(object => ({
            key: object.Key,
            url: `https://${BUCKET_NAME}.s3.amazonaws.com/${object.Key}`,
            lastModified: object.LastModified,
            size: object.Size
        }));

        res.json({ images });
    } catch (error) {
        console.error('Error listing images:', error);
        res.status(500).json({ error: 'Failed to retrieve images' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access your application at: http://localhost:${PORT}`);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit(0);
});
