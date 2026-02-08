// Real email fixtures for testing HTML parsing across platforms

// TopCV Email Alert (from db/emails/2026-01/28/)
export const topCVEmailAlert = {
  id: 'msg-topcv-001',
  threadId: 'thread-topcv-001',
  labelIds: ['INBOX'],
  snippet: 'full stack developer: 10 việc làm mới nhất phù hợp với bạn',
  payload: {
    headers: [
      { name: 'From', value: 'TopCV <toppyai@topcv.vn>' },
      { name: 'Subject', value: '"full stack developer": 10 việc làm mới nhất phù hợp với bạn' },
    ],
    body: {
      data: Buffer.from(`<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html><head><meta charset="UTF-8"/></head><body>
<h1>TopCV Job Alert</h1>
<p>Xin chào <b>Minh Nguyen</b>, chúng tôi đã tìm thấy 10 việc làm mới nhất phù hợp với bạn:</p>
<div class="job-list">
  <div class="job-item">
    <span class="title">Software Developer For Broadband Devices</span>
    <span class="company">MARUSYS VINA CO.,LTD</span>
    <div class="meta-job">
      <div><b>Từ 8 triệu</b></div>
      <div>Hà Nội</div>
      <div>Còn 30 ngày để ứng tuyển</div>
    </div>
  </div>
  <div class="job-item">
    <span class="title">Front-End Developer</span>
    <span class="company">TEQNOLOGICAL ASIA Co., Ltd</span>
    <div class="meta-job">
      <div><b>Thỏa thuận</b></div>
      <div>Hồ Chí Minh (mới)</div>
      <div>Còn 30 ngày để ứng tuyển</div>
    </div>
  </div>
  <div class="job-item">
    <span class="title">(Senior) Software Engineer, ReactJS</span>
    <span class="company">Zalo</span>
    <div class="meta-job">
      <div><b>Thỏa thuận</b></div>
      <div>Hồ Chí Minh</div>
      <div>Vừa đăng</div>
    </div>
  </div>
</div>
<a href="https://www.topcv.vn/tim-viec-lam-full-stack-developer">Xem tất cả việc làm</a>
</body></html>`).toString('base64'),
    },
  },
};

// Indeed Email Alert
export const indeedEmailAlert = {
  id: 'msg-indeed-001',
  threadId: 'thread-indeed-001',
  labelIds: ['INBOX'],
  snippet: 'Indeed Job Alert 20 new front end developer jobs',
  payload: {
    headers: [
      { name: 'From', value: 'noreply@indeed.com' },
      { name: 'Subject', value: 'Indeed Job Alert - 20 new front end developer jobs' },
    ],
    body: {
      data: Buffer.from(`Indeed Job Alert - 20 new front end developer jobs
Jobs 1-20 of 20 new jobs
See matching results on Indeed: https://vn.indeed.com/jobs?q=front+end+developer

Senior Frontend Developer
Zalo - Thành phố Hồ Chí Minh
Zalo VAS delivers new revenue-driving experiences to 75 million+ users. Just posted
https://vn.indeed.com/rc/clk/dl?jk=79f46e3a4498804f

Senior Front-End Developer
AdStart Media Pte. Ltd - Thành phố Hồ Chí Minh
We are seeking an experienced *Senior Front-End Developer* for UI/UX design. 2 days ago
https://vn.indeed.com/rc/clk/dl?jk=3bf80e682b4ae00c

Mid/Senior Frontend Developer (Angular JS)
Hitachi Digital Services - Thành phố Hồ Chí Minh
Design and build responsive web applications using modern frameworks. 6 days ago
https://vn.indeed.com/rc/clk/dl?jk=4c4942dcbef96d14

React Developer
TransPerfect - Hà Nội
The role consists of writing React code and implementing UX/UI designs. 5 days ago
https://vn.indeed.com/rc/clk/dl?jk=72281de2c2521892

Backend Developer - Ngân hàng số
SHB - Hà Nội
Responsible for design and programming of backend services. 3 days ago
https://vn.indeed.com/rc/clk/dl?jk=cdeb23be56926118`).toString('base64'),
    },
  },
};

// TopCV Detail Page (simulating pasted HTML) - FULLY DETAILED
export const topCVDetailPageHTML = `<html>
<head><title>Software Developer For Broadband Devices - MARUSYS VINA</title></head>
<body>
<div class="job-detail">
  <div class="job-detail__header">
    <h1 class="job-detail__info--title">Software Developer For Broadband Devices</h1>
    <div class="job-detail__info--company">
      <span class="company-name">MARUSYS VINA CO.,LTD</span>
      <a class="company-link" href="https://www.topcv.vn/cong-ty/marusys-vina">View Company Profile</a>
    </div>
  </div>
  
  <div class="job-detail__meta">
    <div class="meta-item section-salary">
      <span class="label">Salary:</span>
      <span class="job-detail__info--section-content-value">Từ 8 triệu</span>
    </div>
    <div class="meta-item">
      <span class="label">Experience:</span>
      <span class="value">5+ năm</span>
    </div>
    <div class="meta-item section-location">
      <span class="label">Location:</span>
      <span class="job-detail__info--section-content-value">Hà Nội</span>
    </div>
    <div class="meta-item">
      <span class="label">Job Type:</span>
      <span class="value">Full-time</span>
    </div>
    <div class="meta-item">
      <span class="label">Deadline:</span>
      <span class="value">Còn 30 ngày để ứng tuyển</span>
    </div>
  </div>

  <div class="section section-description">
    <h3>Mô tả công việc</h3>
    <div class="job-description__item--content">
      <p>MARUSYS is a leading technology company specializing in broadband device development and embedded systems. We are looking for experienced Software Developers to join our talented team and contribute to innovative projects.</p>
      
      <strong>Responsibilities:</strong>
      <ul>
        <li>Design and develop software for broadband devices (routers, modems, gateways)</li>
        <li>Develop firmware and embedded system solutions using C++ and TypeScript</li>
        <li>Implement microservices architecture for device communication</li>
        <li>Participate in code review and quality assurance processes</li>
        <li>Collaborate with hardware team to optimize software performance</li>
        <li>Troubleshoot and debug complex system issues</li>
        <li>Document technical specifications and development processes</li>
        <li>Contribute to the improvement of development practices and tools</li>
      </ul>

      <strong>Requirements:</strong>
      <ul>
        <li>5+ years of professional software development experience</li>
        <li>Strong proficiency in C++ and/or TypeScript/Node.js</li>
        <li>Experience with embedded systems and firmware development</li>
        <li>Knowledge of network protocols (TCP/IP, WiFi, Ethernet)</li>
        <li>Experience with microservices architecture and API design</li>
        <li>Proficiency in version control systems (Git)</li>
        <li>Understanding of software development lifecycle (SDLC)</li>
        <li>Experience with testing frameworks and debugging tools</li>
        <li>Excellent problem-solving and analytical skills</li>
        <li>Strong communication and teamwork abilities</li>
        <li>English proficiency (Reading/Writing minimum)</li>
      </ul>

      <strong>Nice to Have:</strong>
      <ul>
        <li>Experience with Docker and containerization</li>
        <li>Knowledge of AWS or cloud services</li>
        <li>Experience with CI/CD pipelines</li>
        <li>Background in IoT (Internet of Things)</li>
        <li>Open source contributions</li>
      </ul>

      <strong>Benefits:</strong>
      <ul>
        <li>Competitive salary: 8-12 triệu VND (based on experience)</li>
        <li>Full health insurance and social insurance</li>
        <li>Annual performance bonus</li>
        <li>Professional development opportunities and training budget</li>
        <li>Flexible working hours and remote work options</li>
        <li>Company trip and team building activities</li>
        <li>Modern work environment with latest technologies</li>
        <li>Career advancement opportunities</li>
      </ul>
    </div>
  </div>

  <div class="section section-company">
    <h2>About Company</h2>
    <div class="company-info">
      <p><strong>Company Name:</strong> MARUSYS VINA CO.,LTD</p>
      <p><strong>Industry:</strong> Information Technology / Telecommunications</p>
      <p><strong>Size:</strong> 100-500 employees</p>
      <p><strong>Website:</strong> <a href="https://www.marusys.vn">https://www.marusys.vn</a></p>
      <p><strong>Address:</strong> Hanoi, Vietnam</p>
      <p><strong>Phone:</strong> +84 24 3232 5555</p>
      <p><strong>Email:</strong> hr@marusys.vn</p>
      <p><strong>Founded:</strong> 2010</p>
      <p><strong>Description:</strong> MARUSYS specializes in designing and manufacturing broadband communication devices. Our products are used by millions of users worldwide. We focus on innovation, quality, and customer satisfaction.</p>
    </div>
  </div>

  <div class="section section-contact">
    <h2>Contact Information</h2>
    <div class="contact-info">
      <p><strong>HR Department:</strong></p>
      <p>Email: recruitment@marusys.vn</p>
      <p>Phone: +84 24 3232 5555 ext. 202</p>
      <p>Address: Tower A, Tech Park Building, 123 Tran Hung Dao, Hanoi, Vietnam</p>
      <p><strong>Working Hours:</strong> Monday - Friday, 8:00 AM - 6:00 PM (UTC+7)</p>
    </div>
  </div>

  <div class="section section-application">
    <a href="https://www.topcv.vn/viec-lam/software-developer-for-broadband-devices/2024732.html" class="btn-apply">Apply Now on TopCV</a>
  </div>
</div>
</body>
</html>`;

// Indeed Detail Page (simulating pasted HTML) - FULLY DETAILED
export const indeedDetailPageHTML = `<html>
<head><title>Senior Frontend Developer - Zalo - Indeed</title></head>
<body>
<div id="jobsearch-page">
  <div id="jobsearch-ViewjobHeader">
    <h1 data-testid="jobsearch-JobInfoHeader-title"><span>Senior Frontend Developer</span></h1>
    <div class="company-header">
      <span data-testid="inlineHeader-companyName" class="company-name">Zalo</span>
      <span class="job-location" data-testid="inlineHeader-companyLocation">Ho Chi Minh City, Vietnam</span>
      <span class="job-type">Full-time</span>
    </div>
    <div id="salaryInfoAndJobType">
      <span class="salary">$1800 - $2500 a month</span>
      <span class="experience">5+ years</span>
      <span class="posting-date">Posted 2 days ago</span>
    </div>
  </div>

  <div class="job-details">
    <div id="jobDescriptionText" class="job-description-section">
      <h2>Job Overview</h2>
      <p>Zalo is looking for experienced Senior Frontend Developers to join our growing team. You will be responsible for designing and implementing high-performance user interfaces for millions of users. This is an exciting opportunity to work with cutting-edge technologies and contribute to one of Southeast Asia's leading messaging and payment platforms.</p>

      <h2>Job Responsibilities</h2>
      <ul>
        <li>Design and develop responsive, high-performance React/TypeScript applications</li>
        <li>Implement complex UI components and features based on design specifications</li>
        <li>Optimize application performance and ensure code quality through best practices</li>
        <li>Write and maintain unit tests, integration tests, and end-to-end tests</li>
        <li>Collaborate with backend developers, designers, and product managers</li>
        <li>Participate in code reviews and provide constructive feedback</li>
        <li>Troubleshoot and resolve frontend issues and bugs</li>
        <li>Stay updated with latest frontend technologies and trends</li>
        <li>Mentor junior developers and contribute to team growth</li>
        <li>Document code and maintain technical documentation</li>
      </ul>

      <h2>Required Qualifications</h2>
      <ul>
        <li>5+ years of professional frontend development experience</li>
        <li>Expert-level knowledge of JavaScript/TypeScript and ES6+</li>
        <li>Strong proficiency in React and modern frontend frameworks</li>
        <li>Advanced understanding of CSS, HTML5, and responsive design</li>
        <li>Experience with state management (Redux, MobX, or similar)</li>
        <li>Proficiency with build tools (Webpack, Vite, or similar)</li>
        <li>Experience with version control systems (Git)</li>
        <li>Strong understanding of REST APIs and API integration</li>
        <li>Knowledge of browser optimization and performance techniques</li>
        <li>Experience with testing frameworks (Jest, React Testing Library, etc.)</li>
        <li>Excellent problem-solving and debugging skills</li>
        <li>Strong communication and teamwork abilities</li>
        <li>Upper-intermediate English proficiency (oral and written)</li>
      </ul>

      <h2>Nice to Have</h2>
      <ul>
        <li>Experience with GraphQL</li>
        <li>Knowledge of TypeScript advanced features</li>
        <li>Experience with CI/CD pipelines</li>
        <li>Familiarity with Docker and containerization</li>
        <li>Experience with web accessibility (WCAG) standards</li>
        <li>Background in building real-time applications</li>
        <li>Experience with payment systems or fintech</li>
        <li>Open source contributions</li>
      </ul>

      <h2>Benefits</h2>
      <ul>
        <li>Competitive salary: $1800 - $2500/month (based on experience and skills)</li>
        <li>Performance bonus and annual incentive</li>
        <li>Comprehensive health insurance (medical, dental, vision)</li>
        <li>Professional development budget for training and certifications</li>
        <li>Flexible working hours and remote work options</li>
        <li>Stock option program (ESOP) for eligible employees</li>
        <li>Fitness center membership and wellness programs</li>
        <li>Free lunch and beverages</li>
        <li>Team building events and company trips</li>
        <li>Mentorship and career advancement opportunities</li>
      </ul>

      <h2>About Zalo</h2>
      <p>Zalo is a leading messaging and payments platform in Southeast Asia with 200+ million users. Founded in 2012, Zalo has grown to become a critical part of digital life for millions of people across the region. We are committed to innovation, security, and delivering exceptional user experience.</p>
      <p><strong>Company Size:</strong> 1000+ employees</p>
      <p><strong>Founded:</strong> 2012</p>
      <p><strong>Website:</strong> https://zalo.me</p>
      <p><strong>Headquarters:</strong> Ho Chi Minh City, Vietnam</p>

      <h2>Application Process</h2>
      <ol>
        <li>Submit your resume and portfolio</li>
        <li>Phone screening with HR team (15 minutes)</li>
        <li>Technical interview with senior engineers (60 minutes)</li>
        <li>System design interview (45 minutes)</li>
        <li>Final interview with hiring manager</li>
        <li>Offer and negotiation</li>
      </ol>

      <h2>Contact Information</h2>
      <div class="contact-details">
        <p><strong>Hiring Team:</strong> Engineering Recruitment</p>
        <p><strong>Email:</strong> careers@zalo.me</p>
        <p><strong>Phone:</strong> +84 28 7777 7777</p>
        <p><strong>Office Address:</strong> Zalo Tower, 185 Tran Hung Dao St., District 1, Ho Chi Minh City, Vietnam</p>
        <p><strong>Office Hours:</strong> Monday - Friday, 8:30 AM - 6:00 PM (UTC+7)</p>
        <p><strong>Application Deadline:</strong> Applications reviewed on a rolling basis</p>
      </div>
    </div>

    <div class="apply-section">
      <a href="https://vn.indeed.com/rc/clk/dl?jk=79f46e3a4498804f" class="btn-apply-indeed">Apply Now on Indeed</a>
    </div>
  </div>
</div>
</body>
</html>`;

// LinkedIn Detail Page (job details only) - minimal structured samples
export const linkedInDetailPageHTMLSample1 = `
  <div class="jobs-search__job-details--wrapper">
    <div aria-label="Research Engineer Intern" class="jobs-search__job-details--container">
      <div class="job-details-jobs-unified-top-card__job-title">
        <h1 class="t-24 t-bold inline"><a>Research Engineer Intern</a></h1>
      </div>
      <div class="job-details-jobs-unified-top-card__company-name">
        <a>Qualcomm</a>
      </div>
      <div class="job-details-jobs-unified-top-card__tertiary-description-container">
        <span class="tvm__text tvm__text--low-emphasis">Ho Chi Minh City Metropolitan Area</span>
      </div>
      <div class="job-details-fit-level-preferences">
        <button><strong>Full-time</strong></button>
        <span class="visually-hidden">Matches your job preferences, job type is Full-time.</span>
      </div>
      <div class="jobs-description__content">
        <div id="job-details">
          <p>
            <span><strong>Company<br><br></strong></span>Qualcomm Vietnam Company Limited
            <span><br><br><strong>Job Area<br><br></strong></span>Interns Group
            <span><br><br><strong>Requirements<br><br></strong></span>
            <span>
              <ul>
                <li>Currently pursuing a Bachelor’s degree</li>
              </ul>
            </span>
            <span><strong>Technical Skills<br><br></strong></span>
            <span>
              <ul>
                <li>Proficiency in Python</li>
              </ul>
            </span>
            <span><strong>Soft Skills<br><br></strong></span>
            <span>
              <ul>
                <li>Strong problem-solving</li>
              </ul>
            </span>
          </p>
        </div>
      </div>
    </div>
  </div>
`;

export const linkedInDetailPageHTMLSample2 = `
  <div class="jobs-search__job-details--wrapper">
    <div aria-label="Software Developers" class="jobs-search__job-details--container">
      <div class="job-details-jobs-unified-top-card__job-title">
        <h1 class="t-24 t-bold inline"><a>Software Developers</a></h1>
      </div>
      <div class="job-details-jobs-unified-top-card__company-name">
        <a>Netcompany</a>
      </div>
      <div class="job-details-jobs-unified-top-card__tertiary-description-container">
        <span class="tvm__text tvm__text--low-emphasis">Củ Chi, Ho Chi Minh City, Vietnam</span>
      </div>
      <div class="job-details-fit-level-preferences">
        <button><strong>Full-time</strong></button>
        <span class="visually-hidden">Matches your job preferences, job type is Full-time.</span>
      </div>
      <div class="jobs-description__content">
        <div id="job-details">
          <p>
            <span><strong>Company Description<br><br></strong></span>Netcompany was founded in 2000
            <span><br><br><strong>Job Description<br><br></strong></span>
            <span>
              <ul>
                <li>Analyze and understand business requirements</li>
              </ul>
            </span>
            <span><strong>Qualifications<br><br></strong></span>
            <span>
              <ul>
                <li>Bachelor or Master degree</li>
              </ul>
            </span>
            <span><strong>Additional Information<br><br></strong></span>
            <span>
              <ul>
                <li>Phone Screening</li>
              </ul>
            </span>
          </p>
        </div>
      </div>
    </div>
  </div>
`;

// Indeed Embedded Detail Page (job details only) - minimal samples
export const indeedEmbeddedDetailPageHTMLSample1 = `
  <section id="job-full-details">
    <div class="jobsearch-JobInfoHeader-title-container">
      <h2 class="jobsearch-JobInfoHeader-title" data-testid="jobsearch-JobInfoHeader-title">
        <span>Senior Full-stack Python Developer (AI Agent) - job post</span>
      </h2>
    </div>
    <div data-testid="inlineHeader-companyName"><span>AnyWork (itworks.asia)</span></div>
    <div data-testid="inlineHeader-companyLocation"><div>Thành phố Hồ Chí Minh</div></div>
    <div id="salaryInfoAndJobType"><span>75,000,000 VNĐ - 104,000,000 VNĐ a month</span></div>
    <div id="jobDescriptionText">
      <p><b>Roles</b></p>
      <ul><li>Own and deliver features end-to-end</li></ul>
      <p><b>Requirements</b></p>
      <ul><li>Strong experience with TypeScript</li></ul>
      <p><b>Benefits &amp; Perks</b></p>
      <ul><li>15 days of annual leave</li></ul>
      <p>Loại hình công việc: Toàn thời gian</p>
    </div>
  </section>
`;

export const indeedEmbeddedDetailPageHTMLSample2 = `
  <section id="job-full-details">
    <div class="jobsearch-JobInfoHeader-title-container">
      <h2 class="jobsearch-JobInfoHeader-title" data-testid="jobsearch-JobInfoHeader-title">
        <span>Data Engineer Fresher - job post</span>
      </h2>
    </div>
    <div data-testid="inlineHeader-companyName"><span>Cigro Inc.</span></div>
    <div data-testid="inlineHeader-companyLocation"><div>Thành phố Hồ Chí Minh</div></div>
    <div id="jobDescriptionText">
      <p><b>Key Responsibilities</b></p>
      <ul><li>Assist in building data pipelines</li></ul>
      <p><b>Requirements</b></p>
      <ul><li>Proficiency in Python</li></ul>
      <p><b>Why you'll love working here</b></p>
      <ul><li>13th-month salary</li></ul>
    </div>
  </section>
`;

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
  id: 'msg-indeed-002',
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

// Mock parsed job for enrichment testing
export const mockParsedJob = {
  messageId: '19c0366ab511e4eb',
  position: 'Software Developer For Broadband Devices',
  company: 'MARUSYS VINA CO.,LTD',
  location: 'Hà Nội',
  salary: 'Từ 8 triệu',
  description: 'Design and develop software for broadband devices. 5+ years of experience with C++, TypeScript, Node.js.',
  url: 'https://www.topcv.vn/viec-lam/software-developer-for-broadband-devices/2024732.html',
  platform: 'topcv',
  matchScore: 0,
  matchedSkills: [],
};
