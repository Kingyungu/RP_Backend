// utils/gridfsStorage.js
import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { createReadStream } from 'fs';
import sharp from 'sharp';
import ErrorHandler from '../middlewares/error.js';

let bucket;

export const initGridFS = () => {
  bucket = new GridFSBucket(mongoose.connection.db, {
    bucketName: 'resumes'
  });
};

export const uploadToGridFS = async (file) => {
  try {
    const filename = `${Date.now()}-${file.name}`;
    const fileBuffer = await processFile(file);

    const metadata = {
      originalName: file.name,
      contentType: file.mimetype,
      size: fileBuffer.length,
      uploadDate: new Date()
    };

    // Use chunked upload for better memory management
    return new Promise((resolve, reject) => {
      const uploadStream = bucket.openUploadStream(filename, {
        chunkSizeBytes: 255 * 1024, // 255KB chunks
        metadata
      });

      const readStream = createReadStream(file.tempFilePath);

      // Handle upload events
      uploadStream.on('error', (error) => {
        console.error('Upload stream error:', error);
        reject(error);
      });

      uploadStream.on('finish', () => {
        resolve({
          fileId: uploadStream.id.toString(),
          filename,
          ...metadata
        });
      });

      // Pipe the file to GridFS
      readStream.pipe(uploadStream);
    });
  } catch (error) {
    console.error('Error uploading to GridFS:', error);
    throw new ErrorHandler('Failed to upload file to GridFS', 500);
  }
};

export const getFileFromGridFS = async (fileId) => {
  try {
    const _id = new mongoose.Types.ObjectId(fileId);
    
    // Get file metadata first
    const files = await bucket.find({ _id }).toArray();
    if (files.length === 0) {
      throw new ErrorHandler('File not found', 404);
    }
    const fileMetadata = files[0];

    // Stream the file data
    return new Promise((resolve, reject) => {
      const chunks = [];
      const downloadStream = bucket.openDownloadStream(_id);
      
      downloadStream
        .on('data', chunk => chunks.push(chunk))
        .on('error', reject)
        .on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            metadata: fileMetadata,
            contentType: fileMetadata.contentType || 'application/pdf'
          });
        });
    });
  } catch (error) {
    console.error('Error retrieving from GridFS:', error);
    throw error;
  }
};

// Helper function to process different file types
const processFile = async (file) => {
  // For images, optimize them
  if (file.mimetype.startsWith('image/')) {
    const buffer = await sharp(file.tempFilePath)
      .resize(1200, null, { // Max width 1200px, maintain aspect ratio
        withoutEnlargement: true,
        fit: 'inside'
      })
      .jpeg({ quality: 80 }) // Convert to JPEG with 80% quality
      .toBuffer();
    
    return buffer;
  }

  // For PDFs and other files, return the original buffer
  return file.tempFilePath;
};