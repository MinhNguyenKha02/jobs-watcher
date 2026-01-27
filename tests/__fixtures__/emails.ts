// Sample job email fixtures for testing all 7 platforms

export const linkedinJobEmail = {
  id: 'msg-linkedin-001',
  threadId: 'thread-001',
  labelIds: ['INBOX'],
  snippet: 'New Senior Software Engineer job at TechCorp - Apply now!',
  payload: {
    headers: [
      { name: 'From', value: 'jobs-noreply@linkedin.com' },
      { name: 'Subject', value: 'Senior Software Engineer at TechCorp' },
    ],
    body: {
      data: Buffer.from(`
        <html>
          <body>
            <h1>Senior Software Engineer</h1>
            <p><strong>Company:</strong> TechCorp Vietnam</p>
            <p><strong>Location:</strong> Ho Chi Minh City, Vietnam</p>
            <p><strong>Job Description:</strong></p>
            <ul>
              <li>5+ years of experience in Node.js and TypeScript</li>
              <li>Strong knowledge of React and modern frontend frameworks</li>
              <li>Experience with microservices architecture</li>
              <li>Excellent communication skills</li>
            </ul>
            <a href="https://www.linkedin.com/jobs/view/123456789">View Job</a>
          </body>
        </html>
      `).toString('base64'),
    },
  },
};

export const indeedJobEmail = {
  id: 'msg-indeed-001',
  threadId: 'thread-002',
  labelIds: ['INBOX'],
  snippet: 'Backend Developer position at StartupHub',
  payload: {
    headers: [
      { name: 'From', value: 'noreply@indeed.com' },
      { name: 'Subject', value: 'Backend Developer - StartupHub' },
    ],
    body: {
      data: Buffer.from(`
        <html>
          <body>
            <h2>Backend Developer</h2>
            <p>StartupHub Inc.</p>
            <p>Da Nang, Vietnam</p>
            <p>Requirements: Python, Django, PostgreSQL, Docker, 3+ years experience</p>
            <p>Salary: $2000-3000/month</p>
            <a href="https://www.indeed.com/viewjob?jk=abc123">Apply Now</a>
          </body>
        </html>
      `).toString('base64'),
    },
  },
};

export const vietnamworksJobEmail = {
  id: 'msg-vnw-001',
  threadId: 'thread-003',
  labelIds: ['INBOX'],
  snippet: 'Full Stack Developer at VietnamTech',
  payload: {
    headers: [
      { name: 'From', value: 'noreply@vietnamworks.com' },
      { name: 'Subject', value: '[VietnamWorks] Full Stack Developer - VietnamTech' },
    ],
    body: {
      data: Buffer.from(`
        <html>
          <body>
            <h1>Full Stack Developer</h1>
            <p>VietnamTech Solutions</p>
            <p>Hanoi, Vietnam</p>
            <p>Skills required: JavaScript, Node.js, React, MongoDB, AWS</p>
            <p>Experience: 2-4 years</p>
            <a href="https://www.vietnamworks.com/job-987654">View Details</a>
          </body>
        </html>
      `).toString('base64'),
    },
  },
};

export const mockProfile = {
  name: 'Minh Nguyen',
  email: 'minh@example.com',
  phone: '+84 123 456 789',
  location: 'Ho Chi Minh City, Vietnam',
  title: 'Senior Software Engineer',
  summary: 'Full-stack developer with 6 years of experience in Node.js, TypeScript, and React',
  skills: [
    'Node.js',
    'TypeScript',
    'React',
    'PostgreSQL',
    'MongoDB',
    'Docker',
    'AWS',
    'Microservices',
    'REST APIs',
    'GraphQL',
  ],
  experience: [
    {
      company: 'Tech Solutions Ltd',
      position: 'Senior Software Engineer',
      location: 'Ho Chi Minh City',
      startDate: '2020-01',
      endDate: 'present',
      description: 'Lead backend development for microservices platform',
      achievements: [
        'Built scalable Node.js microservices handling 1M+ requests/day',
        'Implemented CI/CD pipeline reducing deployment time by 60%',
        'Mentored 5 junior developers',
      ],
    },
    {
      company: 'StartupVN',
      position: 'Full Stack Developer',
      location: 'Hanoi',
      startDate: '2018-06',
      endDate: '2019-12',
      description: 'Full-stack development with React and Node.js',
      achievements: [
        'Developed customer-facing React application',
        'Built REST APIs with Node.js and PostgreSQL',
      ],
    },
  ],
  education: [
    {
      institution: 'Vietnam National University',
      degree: 'Bachelor of Computer Science',
      location: 'Hanoi',
      graduationDate: '2018-05',
    },
  ],
  certifications: [
    'AWS Certified Solutions Architect',
    'MongoDB Certified Developer',
  ],
  links: {
    github: 'https://github.com/minhnguyen',
    linkedin: 'https://linkedin.com/in/minhnguyen',
  },
};
