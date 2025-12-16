import { RecipeCrawlerService } from './crawler';
import { supabase } from './supabaseClient';

const POLL_INTERVAL = 5000; // 5 seconds

async function startWorker() {
  console.log('Worker started. Polling for jobs...');

  while (true) {
    try {
      // 1. Fetch the oldest 'pending' job or 'cooling_down' job whose retry time has passed
      const { data: job, error } = await supabase
        .from('crawl_jobs')
        .select('*')
        .or('status.eq.pending,and(status.eq.cooling_down,next_retry_at.lte.now())')
        .eq('is_archived', false) // Don't pick up archived jobs
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
        console.error('Error fetching job:', error.message);
      }

      if (job) {
        console.log(`Picking up job ${job.id} for ${job.url} (Status: ${job.status})`);

        const isRetry = job.status === 'cooling_down';
        
        // 2. Mark as 'processing' (claim it)
        const { error: claimError } = await supabase
          .from('crawl_jobs')
          .update({ 
            status: 'processing', 
            next_retry_at: null, // Clear retry time
            retry_count: isRetry ? job.retry_count + 1 : job.retry_count, // Increment if it's a retry
            updated_at: new Date().toISOString() 
          })
          .eq('id', job.id);

        if (claimError) {
          console.error('Error claiming job:', claimError.message);
          continue;
        }

        // 3. Execute the crawl
        const crawler = new RecipeCrawlerService(job.id, job.url, isRetry);
        
        // We await here so the worker handles one job at a time (sequential per worker)
        // To run parallel jobs, you launch multiple worker processes via PM2.
        await crawler.start(); 
        
        console.log(`Job ${job.id} finished.`);
      } else {
        // No jobs, wait before polling again
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }

    } catch (err) {
      console.error('Worker loop error:', err);
      // Wait a bit to avoid tight error loops
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

startWorker();
