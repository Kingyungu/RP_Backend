// utils/gridfsStorage.js
import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { createReadStream } from 'fs';
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
    const metadata = {
      originalName: file.name,
      contentType: file.mimetype,
      size: file.size,
      uploadDate: new Date()
    };

    const uploadStream = bucket.openUploadStream(filename, {
      contentType: file.mimetype,
      metadata
    });

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(file.tempFilePath);

      readStream
        .pipe(uploadStream)
        .on('error', (error) => {
          console.error('Upload stream error:', error);
          reject(error);
        })
        .on('finish', () => {
          resolve({
            fileId: uploadStream.id.toString(),
            filename,
            ...metadata
          });
        });
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

    // Get file data
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