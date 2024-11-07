import axios from 'axios';
import pdf from 'pdf-parse';
import Tesseract from 'tesseract.js';

export const extractTextFromPDF = async (pdfUrl) => {
  try {
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
    });
    const data = response.data;
    const text = await pdf(data);
    return text.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw error;
  }
};

export const extractTextFromImage = async (imagePath) => {
  try {
    const result = await Tesseract.recognize(imagePath, 'eng');
    return result.data.text;
  } catch (error) {
    console.error('Error extracting text from image:', error);
    throw error;
  }
};
