/**
 * Constants for job platforms and skill keywords
 */

export const JOB_PLATFORMS = {
  indeed: {
    name: 'Indeed',
    domains: ['indeed.com', 'indeed.vn'],
    patterns: [/indeed/i],
  },
  linkedin: {
    name: 'LinkedIn',
    domains: ['linkedin.com'],
    patterns: [/linkedin/i],
  },
  vietnamworks: {
    name: 'VietnamWorks',
    domains: ['vietnamworks.com'],
    patterns: [/vietnamworks/i],
  },
  careerlink: {
    name: 'CareerLink',
    domains: ['careerlink.vn'],
    patterns: [/careerlink/i],
  },
  topjob: {
    name: 'TopJob',
    domains: ['topjob.vn'],
    patterns: [/topjob/i],
  },
  itviec: {
    name: 'ITviec',
    domains: ['itviec.com'],
    patterns: [/itviec/i],
  },
  topcv: {
    name: 'TopCV',
    domains: ['topcv.vn'],
    patterns: [/topcv/i],
  },
};

export const PLATFORM_NAMES = Object.values(JOB_PLATFORMS).map((p) => p.name);

export const REQUIRED_SKILLS_KEYWORDS = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C++',
  'React',
  'Vue',
  'Angular',
  'Node.js',
  'Express',
  'SQL',
  'MongoDB',
  'AWS',
  'Docker',
  'Kubernetes',
  'Git',
  'Agile',
  'REST API',
  'GraphQL',
  'HTML',
  'CSS',
  'SASS',
  'Webpack',
  'Jest',
  'Testing',
  'CI/CD',
  'DevOps',
  'Linux',
  'Nginx',
  'PostgreSQL',
  'Redis',
  'RabbitMQ',
  'Microservices',
  'Design Patterns',
  'SOLID',
  'Scrum',
];
