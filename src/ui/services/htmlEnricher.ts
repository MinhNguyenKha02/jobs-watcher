import { filterJobCompatibility, loadProfile } from '../../services/constraints.js';
import { HtmlJobParser } from '../../services/parsers/html-job-parser.js';
import type { Job } from '../../types.js';

export async function enrichJobFromHtml(
  html: string,
  currentJob: Job,
  onJobUpdate: (job: Job) => void,
  onMatchScoreUpdate: (score: number) => void
): Promise<Job | null> {
  if (!html || typeof html !== 'string' || !html.trim()) {
    console.log('   ⚠️  HTML enrichment: Empty HTML provided');
    return null;
  }

  try {
    console.log('\n   🔍 HTML Enrichment Starting...');
    console.log('   📧 Current Job Metadata:', {
      position: currentJob.position,
      company: currentJob.company,
      location: currentJob.location,
      salary: currentJob.salary,
      platform: currentJob.platform,
      matchScore: currentJob.matchScore,
    });

    const parser = new HtmlJobParser();
    const parsed = parser.parseJobFromHtml(html);

    if (!parsed || !parsed.title) {
      const lower = html.toLowerCase();
      const looksLikeDetail =
        lower.includes('job-detail__info--title') ||
        lower.includes('jobsearch-jobinfoheader-title');
      if (!looksLikeDetail) {
        console.log('   ❌ HTML parsing failed: No job data extracted');
        console.log(
          '   💡 Tip: paste full job detail page source (View Page Source), then type END on a new line.'
        );
      } else {
        console.log('   ❌ HTML parsing failed: Missing required fields');
      }
      return null;
    }

    console.log('   ✅ Parsed Detail Page:', {
      title: parsed.title,
      company: parsed.company,
      location: parsed.location,
      salary: parsed.salary,
      source: parsed.source,
      hasDescription: !!parsed.description,
      descriptionLength: parsed.description?.length || 0,
    });

    // Update job with parsed data (enriched fields override original)
    const updatedJob: Job = {
      ...currentJob,
      position: parsed.title || currentJob.position,
      company: parsed.company || currentJob.company,
      location: parsed.location || currentJob.location,
      salary: parsed.salary || currentJob.salary,
      url: parsed.url || currentJob.url,
      description: parsed.description || currentJob.description,
      details: parsed.details || currentJob.details,
    };

    // Log what fields were enriched
    const enrichedFields: string[] = [];
    if (parsed.title && parsed.title !== currentJob.position) enrichedFields.push('position');
    if (parsed.company && parsed.company !== currentJob.company) enrichedFields.push('company');
    if (parsed.location && parsed.location !== currentJob.location) enrichedFields.push('location');
    if (parsed.salary && parsed.salary !== currentJob.salary) enrichedFields.push('salary');
    if (parsed.url && parsed.url !== currentJob.url) enrichedFields.push('url');
    if (parsed.description && parsed.description !== currentJob.description)
      enrichedFields.push('description');
    if (parsed.details && parsed.details !== currentJob.details) enrichedFields.push('details');

    console.log(
      '   📝 Enriched Fields:',
      enrichedFields.length > 0 ? enrichedFields.join(', ') : 'none (data same as original)'
    );
    console.log('   💾 Updated Job Metadata:', {
      position: updatedJob.position,
      company: updatedJob.company,
      location: updatedJob.location,
      salary: updatedJob.salary,
      url: updatedJob.url,
      hasDescription: !!updatedJob.description,
    });

    onJobUpdate(updatedJob);

    // Recalculate match score
    const profile = loadProfile();
    const mockEmail = {
      emailId: currentJob.messageId || 'unknown',
      subject: `${parsed.title} at ${parsed.company}`,
      from: 'enriched@html',
      body: html,
      receivedAt: new Date(),
      jobTitle: parsed.title || currentJob.position,
      company: parsed.company || currentJob.company,
      location: parsed.location || currentJob.location || '',
      salary: parsed.salary || currentJob.salary || '',
      description: parsed.description || currentJob.description || '',
      applyUrl: parsed.url || currentJob.url || '',
      source: parsed.source || currentJob.platform,
      platform: parsed.source || currentJob.platform || 'unknown',
    };

    const filterResult = filterJobCompatibility(mockEmail, profile);
    const newMatchScore = filterResult.matchedSkills?.length || 0;
    const oldMatchScore = currentJob.matchScore || 0;

    console.log('   🎯 Match Score Calculation:');
    console.log('      • Profile skills:', profile?.skills?.length || 0);
    console.log('      • Matched skills:', newMatchScore);
    console.log('      • Skills found:', filterResult.matchedSkills?.join(', ') || 'none');
    console.log('      • Score change:', oldMatchScore, '→', newMatchScore);

    // Always call the callback with the match score
    onMatchScoreUpdate(newMatchScore);

    console.log('   ✨ Enrichment Complete!\n');
    return updatedJob;
  } catch (err) {
    console.error('   ❌ HTML enrichment failed:', err);
    return null;
  }
}
