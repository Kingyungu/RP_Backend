import mongoose from "mongoose";
import { Application } from "./models/applicationSchema.js";
import { Job } from "./models/jobSchema.js";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, `config/${process.env.NODE_ENV || 'development'}.env`)
});

const fixJobReferences = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "MERN_JOB_SEEKING_WEBAPP"
    });
    console.log('Connected to MongoDB successfully');

    // Get all jobs
    const allJobs = await Job.find({}).sort({ jobPostedOn: -1 });
    console.log(`\nFound ${allJobs.length} total jobs:`);
    allJobs.forEach(job => {
      console.log(`Job ID: ${job._id}, Title: ${job.title}, Posted: ${job.jobPostedOn}`);
    });

    // Get all applications
    const applications = await Application.find({});
    console.log(`\nFound ${applications.length} total applications`);

    for (const app of applications) {
      console.log(`\nProcessing application ${app._id}:`);
      console.log(`Application date: ${app.createdAt}`);
      
      // Find jobs posted by this employer before the application date
      const eligibleJobs = allJobs.filter(job => 
        job.postedBy.toString() === app.employerID.user.toString() &&
        new Date(job.jobPostedOn) <= new Date(app.createdAt)
      );

      console.log(`Found ${eligibleJobs.length} eligible jobs for this employer`);
      
      if (eligibleJobs.length > 0) {
        // Sort by post date and get the most recent one
        const selectedJob = eligibleJobs.sort((a, b) => 
          new Date(b.jobPostedOn) - new Date(a.jobPostedOn)
        )[0];

        app.jobId = selectedJob._id;
        await app.save();
        console.log(`Updated application with job: ${selectedJob.title} (${selectedJob._id})`);
        console.log(`Posted on: ${selectedJob.jobPostedOn}`);
      } else {
        console.log('No eligible jobs found for this employer and date');
      }
    }

    // Final verification
    const verifyApps = await Application.find({}).populate('jobId');
    console.log('\nVerification Results:');
    verifyApps.forEach(app => {
      console.log(`\nApplication ${app._id}:`);
      console.log(`- Application Date: ${app.createdAt}`);
      console.log(`- Has jobId: ${!!app.jobId}`);
      console.log(`- Job Title: ${app.jobId ? app.jobId.title : 'No job linked'}`);
      console.log(`- Job Posted: ${app.jobId ? app.jobId.jobPostedOn : 'N/A'}`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nDatabase connection closed');
    process.exit(0);
  }
};

console.log('Starting job reference fix...');
fixJobReferences();