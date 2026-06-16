import { chromium } from '@playwright/test';

async function main() {
  console.log('Starting automated booking script...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Navigating to login page...');
    await page.goto('http://localhost:3000/auth/login');
    
    console.log('Entering email...');
    await page.fill('input[type="email"]', 'test_booking_agent@faremind.com');
    await page.click('button:has-text("Send OTP")');
    
    console.log('Entering OTP...');
    await page.waitForSelector('input[type="tel"]');
    const otpInputs = await page.locator('input[type="tel"]').all();
    for (let i = 0; i < 6; i++) {
      await otpInputs[i].fill('123456'[i]);
    }
    
    await page.waitForURL('**/account*'); 
    console.log('Logged in successfully!');

    for (let i = 1; i <= 3; i++) {
      console.log(`--- Starting booking ${i} ---`);
      
      console.log('Going to home page...');
      await page.goto('http://localhost:3000/');
      
      console.log('Selecting origin (SFO)...');
      await page.locator('input[name="fm-origin-airport"]').click();
      await page.locator('input[name="fm-origin-airport"]').fill('San Francisco');
      await page.waitForSelector('button:has-text("SFO")');
      await page.locator('button:has-text("SFO")').first().click();
      
      console.log('Selecting destination (JFK)...');
      await page.locator('input[name="fm-dest-airport"]').click();
      await page.locator('input[name="fm-dest-airport"]').fill('New York');
      await page.waitForSelector('button:has-text("JFK")');
      await page.locator('button:has-text("JFK")').first().click();
      
      console.log('Searching flights...');
      await page.click('button:has-text("Search Flights")');
      
      console.log('Waiting for results...');
      await page.waitForSelector('button:has-text("View")', { timeout: 30000 });
      
      console.log('Viewing the first flight...');
      await page.locator('button:has-text("View")').first().click();
      
      console.log('Clicking Select Fare...');
      await page.waitForSelector('button:has-text("Select Fare")', { timeout: 10000 });
      await page.click('button:has-text("Select Fare")');
      
      try {
        await page.waitForSelector('button:has-text("Continue")', { timeout: 5000 });
        console.log('Clicking continue on fare modal...');
        await page.click('button:has-text("Continue")');
      } catch(e) {
        // May not appear
      }
      
      console.log('Waiting for passenger details page...');
      await page.waitForSelector('input[placeholder="John"]', { timeout: 15000 });
      
      console.log('Filling passenger details...');
      const firstNames = await page.locator('input[placeholder="John"]').all();
      for (const fn of firstNames) {
        await fn.fill('Test');
      }
      const lastNames = await page.locator('input[placeholder="Doe"]').all();
      for (const ln of lastNames) {
        await ln.fill(`User ${i}`);
      }
      
      const emails = await page.locator('input[type="email"]').all();
      if (emails.length > 0) {
        await emails[0].fill('test_booking_agent@faremind.com');
      }
      
      const selects = await page.locator('select').all();
      if (selects.length >= 4) {
        await selects[0].selectOption({ value: '1' }); // US country code
        await selects[1].selectOption({ index: 1 }); // Gender
        await selects[2].selectOption({ index: 1 }); // Nationality
        await selects[3].selectOption({ index: 1 }); // Passport Country
      }
      
      const phones = await page.locator('input[type="tel"]').all();
      if (phones.length > 0) {
        await phones[0].fill('5551234567');
      }
      
      const dateInputs = await page.locator('input[type="date"]').all();
      if (dateInputs.length >= 2) {
        await dateInputs[0].fill('1990-01-01'); // DOB
        await dateInputs[1].fill('2030-01-01'); // Passport Expiry
      }
      
      const passports = await page.locator('input[placeholder="A12345678"]').all();
      if (passports.length > 0) {
        await passports[0].fill(`A12345678${i}`);
      }
      
      console.log('Submitting passenger details...');
      await page.click('button:has-text("Continue")');
      
      const steps = ['seats', 'addons', 'meals'];
      for (const step of steps) {
        try {
          await page.waitForSelector('button:has-text("Continue")', { timeout: 8000 });
          console.log(`Continuing from ${step}...`);
          await page.click('button:has-text("Continue")');
        } catch(e) {
          console.log(`Could not find continue button on ${step}, may have skipped.`);
        }
      }
      
      console.log('Waiting for payment page...');
      try {
        await page.waitForSelector('button:has-text("Pay")', { timeout: 10000 });
        console.log('Clicking Pay...');
        await page.click('button:has-text("Pay")');
      } catch(e) {
        try {
          await page.waitForSelector('button:has-text("Confirm Booking")', { timeout: 5000 });
          console.log('Clicking Confirm Booking...');
          await page.click('button:has-text("Confirm Booking")');
        } catch(e2) {
          console.log('Could not find payment button.');
        }
      }
      
      console.log('Waiting for itinerary confirmation...');
      await page.waitForURL('**/manage-booking/*', { timeout: 20000 });
      console.log(`Booking ${i} completed successfully!`);
    }
  } catch (error) {
    console.error('An error occurred during automation:', error);
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

main();
