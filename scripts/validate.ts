#!/usr/bin/env node

/**
 * Pre-deployment validation script
 * Validates the entire system is ready for production deployment
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

interface ValidationResult {
  passed: boolean;
  message: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DeploymentValidator {
  private results: ValidationResult[] = [];
  private projectRoot = path.join(__dirname, '..');

  validate(): boolean {
    console.log('🚀 Starting pre-deployment validation...\n');

    this.checkEnvironmentVariables();
    this.checkCredentialsFiles();
    this.checkTemplateFiles();
    this.checkProfileFile();
    this.runTypeScriptCompilation();
    this.runAllTests();
    this.checkDependencies();
    
    this.printResults();
    
    return this.results.every(r => r.passed);
  }

  private checkEnvironmentVariables(): void {
    console.log('📋 Checking environment variables...');
    
    const envPath = path.join(this.projectRoot, '.env');
    
    if (!fs.existsSync(envPath)) {
      this.results.push({
        passed: false,
        message: '.env file not found. Create it from .env.example',
      });
      return;
    }

    const envContent = fs.readFileSync(envPath, 'utf-8');
    const requiredVars = [
      'GMAIL_CLIENT_ID',
      'GMAIL_CLIENT_SECRET',
      'GMAIL_REDIRECT_URI',
      'GMAIL_TOPIC_NAME',
    ];

    const missingVars = requiredVars.filter(v => !envContent.includes(v));
    
    if (missingVars.length > 0) {
      this.results.push({
        passed: false,
        message: `Missing environment variables: ${missingVars.join(', ')}`,
      });
    } else {
      this.results.push({
        passed: true,
        message: 'All environment variables configured',
      });
    }
  }

  private checkCredentialsFiles(): void {
    console.log('🔑 Checking credentials files...');
    
    const credentialsPath = path.join(this.projectRoot, 'credentials.json');
    const tokenPath = path.join(this.projectRoot, 'token.json');

    if (!fs.existsSync(credentialsPath)) {
      this.results.push({
        passed: false,
        message: 'credentials.json not found. Download from Google Cloud Console',
      });
    } else {
      this.results.push({
        passed: true,
        message: 'credentials.json exists',
      });
    }

    if (!fs.existsSync(tokenPath)) {
      this.results.push({
        passed: false,
        message: 'token.json not found. Run: npm run auth',
      });
    } else {
      this.results.push({
        passed: true,
        message: 'token.json exists',
      });
    }
  }

  private checkTemplateFiles(): void {
    console.log('📄 Checking template files...');
    
    const templates = ['cv.tex', 'resume.tex', 'cover-letter.md'];
    const templatesDir = path.join(this.projectRoot, 'templates');

    templates.forEach(template => {
      const templatePath = path.join(templatesDir, template);
      if (!fs.existsSync(templatePath)) {
        this.results.push({
          passed: false,
          message: `Template ${template} not found`,
        });
      } else {
        this.results.push({
          passed: true,
          message: `Template ${template} exists`,
        });
      }
    });
  }

  private checkProfileFile(): void {
    console.log('👤 Checking profile file...');
    
    const profilePath = path.join(this.projectRoot, 'resources', 'profile.json');

    if (!fs.existsSync(profilePath)) {
      this.results.push({
        passed: false,
        message: 'resources/profile.json not found',
      });
      return;
    }

    try {
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      const requiredFields = ['name', 'email', 'skills', 'experience'];
      const missingFields = requiredFields.filter(f => !profile[f]);

      if (missingFields.length > 0) {
        this.results.push({
          passed: false,
          message: `Profile missing fields: ${missingFields.join(', ')}`,
        });
      } else {
        this.results.push({
          passed: true,
          message: 'Profile file valid',
        });
      }
    } catch (error) {
      this.results.push({
        passed: false,
        message: 'Profile file is not valid JSON',
      });
    }
  }

  private runTypeScriptCompilation(): void {
    console.log('🔨 Running TypeScript compilation...');
    
    try {
      execSync('npm run build', { 
        cwd: this.projectRoot,
        stdio: 'pipe',
      });
      this.results.push({
        passed: true,
        message: 'TypeScript compilation successful',
      });
    } catch (error) {
      this.results.push({
        passed: false,
        message: 'TypeScript compilation failed',
      });
    }
  }

  private runAllTests(): void {
    console.log('🧪 Running all tests...');
    
    try {
      execSync('npm test', { 
        cwd: this.projectRoot,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
      });
      this.results.push({
        passed: true,
        message: 'All tests passed',
      });
    } catch (error) {
      this.results.push({
        passed: false,
        message: 'Some tests failed',
      });
    }
  }

  private checkDependencies(): void {
    console.log('📦 Checking dependencies...');
    
    try {
      execSync('npm audit --audit-level=high', { 
        cwd: this.projectRoot,
        stdio: 'pipe',
      });
      this.results.push({
        passed: true,
        message: 'No high-severity vulnerabilities',
      });
    } catch (error) {
      this.results.push({
        passed: false,
        message: 'High-severity vulnerabilities detected. Run: npm audit fix',
      });
    }
  }

  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION RESULTS');
    console.log('='.repeat(60) + '\n');

    const passed = this.results.filter(r => r.passed);
    const failed = this.results.filter(r => !r.passed);

    console.log(`✅ Passed: ${passed.length}`);
    console.log(`❌ Failed: ${failed.length}\n`);

    if (failed.length > 0) {
      console.log('Failed checks:');
      failed.forEach(r => {
        console.log(`  ❌ ${r.message}`);
      });
      console.log('');
    }

    if (passed.length === this.results.length) {
      console.log('🎉 All validations passed! System is ready for deployment.\n');
      console.log('Next steps:');
      console.log('  1. Deploy: npm start (or use systemd service)');
      console.log('  2. Monitor: npm run stats');
      console.log('  3. View logs: npm run logs\n');
    } else {
      console.log('⚠️  Some validations failed. Fix the issues above before deploying.\n');
      process.exit(1);
    }
  }
}

// Run validation
const validator = new DeploymentValidator();
const success = validator.validate();

process.exit(success ? 0 : 1);
