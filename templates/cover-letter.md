# Cover Letter

**{{name}}**  
{{email}} | {{phone}}  
{{location}}  
{{#if links.linkedin}}[LinkedIn]({{links.linkedin}}){{/if}} {{#if links.github}}| [GitHub]({{links.github}}){{/if}}

---

**{{date}}**

Hiring Manager  
**{{job.company}}**  

Dear Hiring Manager,

I am writing to express my strong interest in the **{{job.position}}** position at **{{job.company}}**, as advertised on **{{job.platform}}**. With my background in software engineering and passion for building scalable solutions, I am confident I would be a valuable addition to your team.

## Why I'm a Great Fit

{{summary}}

{{#if experience.[0]}}
In my current role as {{experience.[0].position}} at {{experience.[0].company}}, I have:

{{#if experience.[0].achievements}}
{{#each experience.[0].achievements}}
- {{this}}
{{/each}}
{{else}}
- {{experience.[0].description}}
{{/if}}
{{/if}}

## Why {{job.company}}

I am particularly excited about this opportunity at {{job.company}} because of your commitment to innovation and technical excellence. I believe my skills{{#if skills.[0]}} in {{skills.[0]}}{{/if}}{{#if skills.[1]}}, {{skills.[1]}}{{/if}}{{#if skills.[2]}}, and {{skills.[2]}}{{/if}} align perfectly with the requirements for this role.

## What I Can Bring

- **Technical Expertise**: Proficient in {{#each skills}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
- **Problem Solving**: Strong analytical skills with a focus on efficient, maintainable solutions
- **Team Collaboration**: Experience working in agile environments and cross-functional teams
- **Continuous Learning**: Always eager to adopt new technologies and best practices

I would welcome the opportunity to discuss how my experience and skills can contribute to {{job.company}}'s success. Thank you for considering my application.

Best regards,  
**{{name}}**

---

*Portfolio*: {{#if links.portfolio}}{{links.portfolio}}{{else}}Available upon request{{/if}}  
*GitHub*: {{#if links.github}}{{links.github}}{{else}}Available upon request{{/if}}
