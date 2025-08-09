# Next.js Update Issue - August 8, 2025

## Problem Summary
After updating Next.js from version 15.3.4 to ^15.4.6, the calendar component stopped displaying workout data correctly:
- Completed workouts from Tuesday 8/5 (Push) and Wednesday 8/6 (Pull) were showing as Rest/Missed
- The dashboard was showing incorrect workout recommendations
- The stats page was still showing correct data, indicating the issue was with display logic, not data storage

## Root Cause Analysis
The issue appears to be related to how Next.js 15.4.6 handles date/timezone operations differently from 15.3.4. Specific areas that may have been affected:

1. **Client-Side Date Handling**: The calendar component uses client-side date calculations to determine which workouts to display
2. **Timezone Conversion**: The component extracts dates from timestamps using string operations to avoid timezone conversion issues
3. **Date String Formatting**: The way dates are formatted and compared may have changed between versions

## Solution
Reverted to Next.js 15.3.4 by:
1. Running `git checkout -- package.json package-lock.json` to restore the original versions
2. Removing corrupted node_modules directory
3. Running `npm ci` from within WSL to ensure clean installation

## Recommendations for Future Updates
When attempting to update Next.js again:

1. **Test Date-Related Components First**: Focus testing on the calendar and any other date-dependent features
2. **Check Breaking Changes**: Review Next.js changelog for any changes to:
   - Date/time handling
   - Client-side rendering behavior
   - Timezone management
   
3. **Consider Gradual Updates**: Instead of jumping from 15.3.4 to 15.4.6+, try intermediate versions
4. **Review Code for Date Operations**: The calendar component may need updates to work with newer Next.js versions, particularly around:
   - The date extraction logic in `loadUserData()`
   - The date comparison logic in `generateCalendarData()`
   - The timezone handling throughout the component

## Code Areas to Review
- `/src/app/calendar/page.tsx` - Main calendar component
- Date extraction: `e.workout_local_date_time.split('T')[0]`
- Date generation logic in `generateCalendarData()`
- Any use of Date objects that might be affected by SSR/CSR differences
