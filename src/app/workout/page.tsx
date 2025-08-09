'use client'

import { useState, useEffect } from 'react'
import { supabase, X3_EXERCISES, BAND_COLORS, getTodaysWorkoutWithCompletion } from '@/lib/supabase'
import { announceToScreenReader } from '@/lib/accessibility'
import { Play, Flame, Calendar, ArrowRight, Sparkles, TrendingUp, Users, Shield } from 'lucide-react'
import React from 'react'
import X3MomentumWordmark from '@/components/X3MomentumWordmark'
import AppLayout from '@/components/layout/AppLayout'
import { useSubscription } from '@/contexts/SubscriptionContext'
import { useX3TTS } from '@/hooks/useX3TTS'
import { useRouter } from 'next/navigation'
import { testModeService } from '@/lib/test-mode'
import { getCurrentCentralISOString } from '@/lib/timezone'
import { ttsPhaseService } from '@/lib/tts-phrases'
import ExerciseCard from '@/components/ExerciseCard'
import AnimatedCadenceButton from '@/components/AnimatedCadenceButton';
import { getWorkoutHistoryData } from '@/lib/exercise-history'

// Helper to get local ISO string with timezone offset
// Updated to use Central time with proper DST handling
function getLocalISODateTime() {
  const timestamp = getCurrentCentralISOString();
  console.log('🕒 Generated Central timestamp:', timestamp);
  return timestamp;
}

// Helper to format workout dates correctly without timezone conversion
function formatWorkoutDate(timestamp: string): string {
  // Extract just the date part if it's an ISO timestamp
  const dateStr = timestamp.split('T')[0];
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    return `${month}/${day}/${year}`;
  }
  
  // Fallback to original method if format is unexpected
  return new Date(timestamp).toLocaleDateString();
}




function playBeep() {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtx();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 880; // Hz
  gain.gain.value = 0.1;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.1); // short beep
  oscillator.onended = () => ctx.close();
}

// Legacy TTS function - replaced by useX3TTS hook
// Keeping for reference, but all calls should use speak() from useX3TTS
function speakText(text: string, hasFeature: boolean) {
  // This function is deprecated - use speak() from useX3TTS instead
  console.warn('⚠️ speakText is deprecated, use speak() from useX3TTS hook')
}

interface Exercise {
  id?: string;
  exercise_name: string;
  band_color: string;
  full_reps: number;
  partial_reps: number;
  notes: string;
  saved: boolean;
  previousData?: any;
  workout_local_date_time: string;
  name: string;
  band: string;
  fullReps: number;
  partialReps: number;
  lastWorkout: string;
  lastWorkoutDate: string;
}

export default function HomePage() {


  const [user, setUser] = useState<any>(null);
  const [todaysWorkout, setTodaysWorkout] = useState<any>(null);
  const [cadenceActive, setCadenceActive] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [cadenceInterval, setCadenceInterval] = useState<NodeJS.Timeout | null>(null);
  const [restTimer, setRestTimer] = useState<{ isActive: boolean; timeLeft: number; exerciseIndex: number } | null>(null);
  const [restTimerInterval, setRestTimerInterval] = useState<NodeJS.Timeout | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [exerciseLoadingStates, setExerciseLoadingStates] = useState<{ [key: number]: boolean }>({});
  const [exerciseStates, setExerciseStates] = useState<{ [key: number]: 'idle' | 'started' | 'in_progress' | 'completed' }>({});
  const [ttsActiveStates, setTtsActiveStates] = useState<{ [key: number]: boolean }>({});
  const [saveLoadingStates, setSaveLoadingStates] = useState<{ [key: number]: boolean }>({});
  const [saveErrorStates, setSaveErrorStates] = useState<{ [key: number]: string | null }>({});
  const { hasFeature, tier } = useSubscription();
  const { speak, isLoading: ttsLoading, error: ttsError, getSourceIndicator } = useX3TTS();
  const router = useRouter();
  const getTomorrowsWorkout = () => {
    if (!user || !todaysWorkout) return 'Push';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    return 'Push';
  }

  const startExercise = async (index: number) => {
    const exercise = exercises[index]
    
    console.log('🚀 Starting exercise:', exercise.name)
    
    // Set exercise state to started
    setExerciseStates(prev => ({ ...prev, [index]: 'started' }))
    setExerciseLoadingStates(prev => ({ ...prev, [index]: true }))
    
    try {
      // Only use TTS for premium users
      if (hasFeature('ttsAudioCues')) {
        setTtsActiveStates(prev => ({ ...prev, [index]: true }))
        
        // Get exercise start phrase from phrase library
        const startPhrase = ttsPhaseService.getExerciseStartPhrase(
          exercise.name, 
          tier === 'mastery' ? 'mastery' : 'momentum'
        )
        
        // Speak the start phrase with exercise context
        await speak(startPhrase, 'exercise')
        
        setTtsActiveStates(prev => ({ ...prev, [index]: false }))
        
        // Screen reader announcement with audio guidance
        announceToScreenReader(`Starting ${exercise.name} with audio guidance. Exercise is now in progress.`, 'assertive')
      } else {
        // Basic screen reader announcement for Foundation users
        announceToScreenReader(`Starting ${exercise.name}. Exercise is now in progress.`, 'assertive')
      }
      
      // Set exercise state to in progress after TTS completes (or immediately for Foundation users)
      setExerciseStates(prev => ({ ...prev, [index]: 'in_progress' }))
      
      // Start cadence automatically
      if (!cadenceActive) {
        setCadenceActive(true)
        console.log('🎵 Auto-starting cadence for exercise')
      }
      
    } catch (error) {
      console.error('Error starting exercise:', error)
      setExerciseStates(prev => ({ ...prev, [index]: 'idle' }))
      setTtsActiveStates(prev => ({ ...prev, [index]: false }))
    } finally {
      // Clear loading state for this exercise button
      setExerciseLoadingStates(prev => ({ ...prev, [index]: false }))
    }
  }

  // Metronome beep effect: always call useEffect at the top level
  useEffect(() => {
    console.log('🎵 Cadence useEffect triggered - cadenceActive:', cadenceActive);
    console.log('🎵 useEffect values - hasFeature:', typeof hasFeature, 'tier:', tier, 'speak:', typeof speak);
    
    // Clear any existing interval first to prevent multiple instances
    if (cadenceInterval) {
      clearInterval(cadenceInterval);
      setCadenceInterval(null);
    }

    if (cadenceActive) {
      playBeep(); // play immediately
      
      // TTS for cadence start - debug logging
      console.log('🎵 TTS Debug: hasFeature(ttsAudioCues):', hasFeature('ttsAudioCues'));
      console.log('🎵 TTS Debug: tier:', tier);
      console.log('🎵 TTS Debug: speak function available:', typeof speak);
      
      if (hasFeature('ttsAudioCues')) {
        const cadencePhrase = ttsPhaseService.getCadencePhrase(tier === 'mastery' ? 'mastery' : 'momentum');
        console.log('🎵 TTS Debug: cadencePhrase:', cadencePhrase);
        speak(cadencePhrase, 'exercise');
        console.log('🎵 TTS Debug: speak() called for cadence');
      } else {
        console.log('🎵 TTS Debug: ttsAudioCues feature not available - skipping TTS');
      }
      
      // Use the state-managed interval for consistency
      const interval = setInterval(() => {
        playBeep();
      }, 2000);
      setCadenceInterval(interval);
      console.log('🎵 Cadence interval started:', interval);
    } else {
      console.log('🎵 Cadence stopped');
    }

    return () => {
      // Cleanup happens in the next effect or when cadenceActive becomes false
    };
  }, [cadenceActive, hasFeature, tier, speak]);

  // Separate effect to cleanup cadence interval when needed
  useEffect(() => {
    if (!cadenceActive && cadenceInterval) {
      console.log('🎵 Cleaning up cadence interval:', cadenceInterval);
      clearInterval(cadenceInterval);
      setCadenceInterval(null);
    }
  }, [cadenceActive, cadenceInterval]);

  // Rest timer effect - Fixed to prevent interval recreation on every tick
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (restTimer?.isActive && restTimer.timeLeft > 0) {
      interval = setInterval(() => {
        setRestTimer(prev => {
          if (!prev || prev.timeLeft <= 1) {
            // Timer finished - DO NOT speak rest complete phrase here
            // The next exercise will auto-start and speak exercise start phrase
            console.log('⏰ Rest timer finished - transitioning to next exercise');
            return null;
          }
          
          const newTimeLeft = prev.timeLeft - 1;
          
          // Just decrement the timer - cadence logic is handled in separate effect
          return { ...prev, timeLeft: newTimeLeft };
        });
      }, 1000);
      setRestTimerInterval(interval);
    } else {
      if (restTimerInterval) {
        clearInterval(restTimerInterval);
        setRestTimerInterval(null);
      }
    }

    return () => {
      if (interval) {
        clearInterval(interval);
        setRestTimerInterval(null);
      }
    };
  }, [restTimer?.isActive]); // Removed tier and speak to avoid dependencies
  
  // Separate effect to handle precise countdown timing during rest timer
  useEffect(() => {
    if (!restTimer?.isActive || cadenceActive) return;
    
    const timeLeft = restTimer.timeLeft;
    const nextExerciseIndex = restTimer.exerciseIndex + 1;
    
    // Only proceed if there's a next exercise
    if (nextExerciseIndex >= exercises.length) return;
    
    const nextExercise = exercises[nextExerciseIndex];
    console.log(`⏰ Rest timer: ${timeLeft}s remaining (${90 - timeLeft}s elapsed) for next exercise: ${nextExercise.name}`);
    
    // CORRECTED: Calculate elapsed time for proper countdown timing
    const timeElapsed = 90 - timeLeft; // How much time has passed since timer started
    
    // Countdown happens in the FINAL 8 seconds (when 84+ seconds have elapsed)
    if (timeElapsed === 84) { // 84 seconds elapsed = 6 seconds remaining
      console.log('⏰ TTS: Speaking "three" at 84 seconds ELAPSED (6 seconds remaining)');
      speak('three', 'countdown');
    } else if (timeElapsed === 86) { // 86 seconds elapsed = 4 seconds remaining
      console.log('⏰ TTS: Speaking "two" at 86 seconds ELAPSED (4 seconds remaining)');
      speak('two', 'countdown');
    } else if (timeElapsed === 88) { // 88 seconds elapsed = 2 seconds remaining
      console.log('⏰ TTS: Speaking "one" at 88 seconds ELAPSED (2 seconds remaining)');
      speak('one', 'countdown');
      // Start cadence for final countdown
      setCadenceActive(true);
      console.log('🎵 Starting cadence for next exercise prep during final countdown');
    } else if (timeElapsed === 80) { // 80 seconds elapsed = 10 seconds remaining
      // CORRECTED: Lead-in phrase timing to end just before countdown
      // Estimate: "Get ready for [exercise name] in" takes about 3-4 seconds to say
      // Start at 80 seconds elapsed (10 remaining) to finish by 83-84 seconds elapsed
      const leadInPhrase = `Get ready for ${nextExercise.name} in`;
      console.log(`⏰ TTS: Speaking lead-in phrase at 80 seconds ELAPSED (10 seconds remaining): "${leadInPhrase}"`);
      speak(leadInPhrase, 'rest');
    }
  }, [restTimer?.timeLeft, restTimer?.isActive, cadenceActive, restTimer?.exerciseIndex, exercises, tier, speak, setCadenceActive]);

  // Auto-start next exercise when rest timer finishes
  useEffect(() => {
    // Only trigger when restTimer changes from active to null (timer just finished)
    if (restTimer === null && exercises.length > 0) {
      // Find the most recent completed exercise to determine the next one
      const completedExercises = Object.entries(exerciseStates)
        .filter(([_, state]) => state === 'completed')
        .map(([index, _]) => parseInt(index));
      
      if (completedExercises.length > 0) {
        const lastCompletedIndex = Math.max(...completedExercises);
        const nextExerciseIndex = lastCompletedIndex + 1;
        
        // Only auto-start if we have a next exercise and it's not already started
        if (nextExerciseIndex < exercises.length && 
            (!exerciseStates[nextExerciseIndex] || exerciseStates[nextExerciseIndex] === 'idle')) {
          
          console.log(`🚀 Rest timer finished! Auto-starting next exercise: ${exercises[nextExerciseIndex].exercise_name} (index ${nextExerciseIndex})`);
          
          // Auto-start the next exercise after a short delay to let cadence settle
          setTimeout(() => {
            startExercise(nextExerciseIndex);
          }, 500);
        }
      }
    }
  }, [restTimer, exercises, exerciseStates, startExercise]); // Watch for restTimer becoming null

  useEffect(() => {
    console.log('useEffect running, setting mounted to true')
    
    // Get user and setup
    const getUser = async () => {
      console.log('🔍 Starting getUser function...')
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (authError) {
        console.error('❌ Auth error details:', {
          message: authError.message,
          status: authError.status,
          code: authError.code,
          details: authError
        })
        // Try to get session instead
        console.log('🔄 Trying to get session instead...')
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !session?.user) {
          console.log('👤 No user found - redirecting to sign in')
          router.push('/auth/signin')
          return
        }
        console.log('✅ Found user via session:', session.user.id)
        setUser(session.user)
      }
      
      console.log('👤 User data:', user)
      
      if (user) {
        setUser(user)
        announceToScreenReader('Welcome to X3 Tracker. Loading your workout data.')
        
        // Get user's start date
        console.log('� Fetching user profile for ID:', user.id)
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('x3_start_date')
          .eq('id', user.id)
          .single()
        
        console.log('📊 Profile data:', profile)
        console.log('❌ Profile error:', profileError)
        
        if (profileError) {
          console.error('❌ Error fetching profile:', profileError)
          // If profile doesn't exist, create one with today's date
          if (profileError.code === 'PGRST116') {
            console.log('🆕 Creating new profile with today as start date...')
            // Use local date to avoid timezone issues
            const today = (() => {
              const now = new Date();
              return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            })()
            const { error: insertError } = await supabase
              .from('profiles')
              .insert({
                id: user.id,
                x3_start_date: today
              })
            
            if (insertError) {
              console.error('❌ Error creating profile:', insertError)
            } else {
              console.log('✅ Profile created successfully')
              const workout = await getTodaysWorkoutWithCompletion(today, user.id)
              setTodaysWorkout(workout)
            }
          }
        } else if (profile?.x3_start_date) {
          console.log('✅ Found start date:', profile.x3_start_date)
          const workout = await getTodaysWorkoutWithCompletion(profile.x3_start_date, user.id)
          setTodaysWorkout(workout)
        } else {
          console.log('⚠️ No start date found in profile')
        }
      } else {
        console.log('👤 No user found')
        router.push('/auth/signin')
        return
      }
    }
    
    getUser()
  }, [])

  // Separate useEffect to handle workout setup when user and todaysWorkout are available
  useEffect(() => {
    if (user && todaysWorkout && todaysWorkout.workoutType !== 'Rest') {
      console.log('🏋️ Setting up exercises for workout type:', todaysWorkout.workoutType)
      setupExercises(todaysWorkout.workoutType as 'Push' | 'Pull')
      announceToScreenReader(`Today's ${todaysWorkout.workoutType} workout is ready. Week ${todaysWorkout.week}.`)
    } else if (user && todaysWorkout && todaysWorkout.workoutType === 'Rest') {
      announceToScreenReader(`Today is a rest day. Week ${todaysWorkout.week}.`)
    }
  }, [user, todaysWorkout])


  const setupExercises = async (workoutType: 'Push' | 'Pull') => {
    if (!user?.id) {
      console.log('No user ID available yet')
      return
    }
    
    console.log('🏋️ Setting up exercises with band hierarchy logic for:', workoutType, 'User ID:', user.id)
    
    const exerciseNames = X3_EXERCISES[workoutType]
    console.log('📋 Exercise names:', exerciseNames)
    
    // Get exercise history data for ALL exercises using our band hierarchy logic
    console.log('📊 Getting workout history data for all exercises...')
    const historyData = await getWorkoutHistoryData(exerciseNames, workoutType)
    console.log('📈 History data received:', historyData)
    
    // Get recent workout data for other fields (notes, dates, etc.)
    const { data: previousData, error } = await supabase
      .from('workout_exercises')
      .select('*')
      .eq('user_id', user.id)
      .eq('workout_type', workoutType)
      .order('created_at_utc', { ascending: false })
      .limit(16)
    
    console.log('📋 Previous workout data for context:', previousData)
    console.log('❌ Query error:', error)
    
    // Create exercise data using recent workout data for input fields and historical best for display
    const exerciseData = exerciseNames.map(name => {
      const history = historyData[name]
      
      console.log(`🎯 Processing ${name}:`)
      console.log(`  - History data:`, history)
      
      return {
        id: '',
        exercise_name: name,
        band_color: (history?.recentBand || 'White') as 'White' | 'Light Gray' | 'Dark Gray' | 'Black' | 'Elite' | 'Ultra Light',
        full_reps: history?.recentFullReps || 0,
        partial_reps: history?.recentPartialReps || 0,
        notes: '',
        saved: false,
        previousData: null,
        workout_local_date_time: history?.recentWorkoutDate || '',
        // UI fields - name shows historical PR, input fields use recent data
        name: history?.displayText || name.toUpperCase(), // "CHEST PRESS (PR: 16)" or "CHEST PRESS"
        band: (history?.recentBand || 'White') as 'White' | 'Light Gray' | 'Dark Gray' | 'Black' | 'Elite' | 'Ultra Light', // Pre-fill with recent band
        fullReps: history?.recentFullReps || 0, // Pre-fill with recent full reps
        partialReps: history?.recentPartialReps || 0, // Pre-fill with recent partial reps
        lastWorkout: history?.recentWorkoutDate ? `${history.recentFullReps}+${history.recentPartialReps} reps with ${history.recentBand} band` : '',
        lastWorkoutDate: history?.recentWorkoutDate ? formatWorkoutDate(history.recentWorkoutDate) : ''
      }
    })
    
    console.log('✅ Final exercise data with band hierarchy:', exerciseData)
    
    // Debug: Log what will be passed to ExerciseCard for each exercise
    exerciseData.forEach((exercise, index) => {
      console.log(`🔍 Exercise ${index} (${exercise.name}) will show in card:`)
      console.log(`  - Band: ${exercise.band} (from recent: ${historyData[exercise.exercise_name]?.recentBand})`)
      console.log(`  - Full Reps: ${exercise.fullReps} (from recent: ${historyData[exercise.exercise_name]?.recentFullReps})`)
      console.log(`  - Partial Reps: ${exercise.partialReps} (from recent: ${historyData[exercise.exercise_name]?.recentPartialReps})`)
    })
    
    setExercises(exerciseData)
    
    if (previousData && previousData.length > 0) {
      const lastWorkoutDate = formatWorkoutDate(previousData[0].workout_local_date_time)
      announceToScreenReader(`Previous ${workoutType} workout data loaded from ${lastWorkoutDate}`)
    }
    
    // Log success for each exercise
    exerciseData.forEach(exercise => {
      if (exercise.name.includes('PR:')) {
        console.log(`✨ ${exercise.exercise_name}: Display "${exercise.name}", Recent data - Band: ${exercise.band}, Reps: ${exercise.fullReps}+${exercise.partialReps}`)
      } else {
        console.log(`📝 ${exercise.exercise_name}: No history - Display "${exercise.name}", Default values`)
      }
    })
  }

  const updateExercise = (index: number, field: string, value: any) => {
    const newExercises = [...exercises]
    newExercises[index] = { ...newExercises[index], [field]: value, saved: false }
    if (!newExercises[index].workout_local_date_time) {
      newExercises[index].workout_local_date_time = getLocalISODateTime()
    }
    setExercises(newExercises)
    
    // Stop cadence if running
    if (cadenceActive) {
      console.log('🎵 Stopping cadence from updateExercise');
      setCadenceActive(false)
      announceToScreenReader('Cadence stopped')
    }

    // Announce changes to screen readers
    if (field === 'band') {
      announceToScreenReader(`${newExercises[index].name} band changed to ${value}`)
    } else if (field === 'fullReps' || field === 'partialReps') {
      announceToScreenReader(`${newExercises[index].name} ${field.replace('_', ' ')} set to ${value}`)
    }
  }

  const saveExercise = async (index: number) => {
    console.log('💾 Starting save for exercise index:', index)
    
    // Set loading state
    setSaveLoadingStates(prev => ({ ...prev, [index]: true }))
    setSaveErrorStates(prev => ({ ...prev, [index]: null }))
    
    if (!user || !todaysWorkout) {
      console.error('❌ Missing user or todaysWorkout:', { user: !!user, todaysWorkout: !!todaysWorkout })
      setSaveLoadingStates(prev => ({ ...prev, [index]: false }))
      setSaveErrorStates(prev => ({ ...prev, [index]: 'Missing user or workout data. Please refresh the page.' }))
      return
    }

    const exercise = exercises[index]
    console.log('🔍 Exercise object:', exercise)
    
    // Always use current timestamp to avoid duplicates
    const workoutLocalDateTime = getLocalISODateTime()
    console.log('🕒 Using fresh timestamp:', workoutLocalDateTime)
    
    console.log('📊 Exercise data to save:', exercise)
    console.log('🕒 Workout time:', workoutLocalDateTime)
    console.log('👤 User ID:', user.id)
    console.log('🏋️ Workout type:', todaysWorkout.workoutType)
    console.log('📈 Week number:', todaysWorkout.week)

    announceToScreenReader('Saving exercise data...', 'assertive')

    const dataToSave = {
      user_id: user.id,
      workout_local_date_time: workoutLocalDateTime,
      workout_type: todaysWorkout.workoutType,
      week_number: todaysWorkout.week,
      exercise_name: exercise.exercise_name,
      band_color: exercise.band as 'White' | 'Light Gray' | 'Dark Gray' | 'Black' | 'Elite' | 'Ultra Light',
      full_reps: exercise.fullReps,
      partial_reps: exercise.partialReps,
      notes: exercise.notes
    }
    
    console.log('💾 Data being sent to Supabase:', dataToSave)

    console.log('🎯 About to save workout data...')
    
    let data, error
    
    // Check if test mode is enabled
    if (testModeService.shouldMockWorkouts()) {
      console.log('🧪 Test Mode: Intercepting workout save, adding to mock data')
      
      // Add to mock workout data
      testModeService.addMockWorkout({
        date: workoutLocalDateTime.split('T')[0],
        workout_type: todaysWorkout.workoutType,
        exercises: [{
          exercise_name: exercise.exercise_name,
          band_color: exercise.band as 'White' | 'Light Gray' | 'Dark Gray' | 'Black' | 'Elite' | 'Ultra Light',
          full_reps: exercise.fullReps,
          partial_reps: exercise.partialReps
        }]
      })
      
      // Simulate successful response for test mode
      data = [{ ...dataToSave, id: `test-${Date.now()}` }]
      error = null
      
      console.log('🧪 Test Mode: Mock save successful')
    } else {
      // First, let's see what records already exist for this user/exercise
      const { data: existingRecords, error: checkError } = await supabase
        .from('workout_exercises')
        .select('*')
        .eq('user_id', user.id)
        .eq('exercise_name', exercise.exercise_name)
        .order('created_at_utc', { ascending: false })
        .limit(3)
      
      console.log('🔍 Existing records for this exercise:', existingRecords)
      console.log('🔍 Check error:', checkError)
      
      // Try a simple insert with fresh timestamp
      console.log('🚀 Attempting insert operation with fresh timestamp...')
      const result = await supabase
        .from('workout_exercises')
        .insert(dataToSave)
        .select()
      
      data = result.data
      error = result.error
    }

    console.log('📤 Supabase response data:', data)
    console.log('❌ Supabase error:', error)
    
    // Let's also check what's actually in the table after the insert
    if (!error) {
      console.log('🔍 Checking what was actually saved...')
      const { data: checkData, error: checkError } = await supabase
        .from('workout_exercises')
        .select('*')
        .eq('user_id', user.id)
        .eq('workout_local_date_time', workoutLocalDateTime)
        .eq('exercise_name', exercise.exercise_name)
        .limit(5)
      
      console.log('📋 Recent records in workout_exercises:', checkData)
      console.log('❌ Check error:', checkError)
      
      // Also check user profile
      const { data: profileCheck, error: profileCheckError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .limit(1)
      
      console.log('📋 User profile:', profileCheck)
      console.log('❌ Profile check error:', profileCheckError)
      
      // Check the most recent workout data
      if (checkData && checkData.length > 0) {
        console.log('🕐 Most recent workout:')
        console.log('  Exercise:', checkData[0].exercise_name)
        console.log('  Date:', checkData[0].workout_local_date_time)
        console.log('  Type:', checkData[0].workout_type)
      }
    }

    if (!error) {
      const newExercises = [...exercises]
      newExercises[index].saved = true
      setExercises(newExercises)
      setExerciseStates(prev => ({ ...prev, [index]: 'completed' }))
      setRefreshTrigger(prev => prev + 1) // Trigger workout history refresh
      console.log('✅ Exercise saved successfully!')
      announceToScreenReader(`${exercise.name} saved successfully!`, 'assertive')
      
      // Clear loading and error states
      setSaveLoadingStates(prev => ({ ...prev, [index]: false }))
      setSaveErrorStates(prev => ({ ...prev, [index]: null }))
      
      // Stop cadence if it's running (important for final exercise)
      if (cadenceActive) {
        console.log('🎵 Stopping cadence after exercise save')
        setCadenceActive(false)
        announceToScreenReader('Cadence stopped')
      }
      
      // Add TTS audio cue for exercise completion with better context detection
      const nextIndex = index + 1
      const isLastExercise = nextIndex >= exercises.length
      
      console.log(`🎯 Context Detection: Exercise ${index + 1} of ${exercises.length} (${exercise.name})`);
      console.log(`🎯 Next index: ${nextIndex}, Is last exercise: ${isLastExercise}`);
      
      if (hasFeature('ttsAudioCues')) {
        if (isLastExercise) {
          // Final exercise - workout completion
          console.log('🎉 TTS Context: WORKOUT COMPLETION');
          const nextWorkoutType = getTomorrowsWorkout()
          const completionPhrase = ttsPhaseService.getWorkoutCompletionPhrase(
            todaysWorkout.workoutType, 
            nextWorkoutType, 
            tier === 'mastery' ? 'mastery' : 'momentum'
          )
          console.log(`🎉 Speaking completion phrase: "${completionPhrase}" with exercise context`);
          speak(completionPhrase, 'exercise')
        } else {
          // Exercise transition
          console.log('🔄 TTS Context: EXERCISE TRANSITION');
          const nextExercise = exercises[nextIndex]?.name || "your next exercise"
          console.log(`🔄 Transitioning from ${exercise.name} to ${nextExercise}`);
          const transitionPhrase = ttsPhaseService.getExerciseTransitionPhrase(
            exercise.name,
            nextExercise,
            tier === 'mastery' ? 'mastery' : 'momentum'
          )
          console.log(`🔄 Speaking transition phrase: "${transitionPhrase}" with exercise context`);
          speak(transitionPhrase, 'exercise')
        }
      }
      
      // Start 90-second rest timer for Momentum/Mastery users (but not for last exercise)
      if (hasFeature('restTimer') && !isLastExercise) {
        setRestTimer({
          isActive: true,
          timeLeft: 90,
          exerciseIndex: index
        })
      }
    } else {
      console.error('❌ Error saving exercise:', error)
      
      // Set error state and clear loading
      setSaveLoadingStates(prev => ({ ...prev, [index]: false }))
      
      let errorMessage = 'Unknown error occurred. Please try again.'
      if (error) {
        console.error('❌ Error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        })
        
        // Create user-friendly error message
        if (error.code === 'PGRST116') {
          errorMessage = 'No database connection. Please check your internet connection.'
        } else if (error.message?.includes('duplicate')) {
          errorMessage = 'This exercise has already been saved for today.'
        } else if (error.message?.includes('permission')) {
          errorMessage = 'Permission denied. Please sign out and back in.'
        } else if (error.message) {
          errorMessage = error.message
        }
        
        announceToScreenReader(`Error saving exercise: ${errorMessage}`, 'assertive')
      } else {
        console.error('❌ Unknown error occurred')
        announceToScreenReader('Unknown error saving exercise. Please try again.', 'assertive')
      }
      
      setSaveErrorStates(prev => ({ ...prev, [index]: errorMessage }))
    }
  }

  const retrySaveExercise = (index: number) => {
    console.log('🔄 Retrying save for exercise index:', index)
    saveExercise(index)
  }

  const getExerciseInfoUrl = (exerciseName: string) => {
    const exerciseUrls: { [key: string]: string } = {
      'Chest Press': 'https://www.jaquishbiomedical.com/exercise/chest-press/',
      'Tricep Press': 'https://www.jaquishbiomedical.com/exercise/tricep-press/',
      'Overhead Press': 'https://www.jaquishbiomedical.com/exercise/overhead-press/',
      'Front Squat': 'https://www.jaquishbiomedical.com/exercise/front-squat/',
      'Deadlift': 'https://www.jaquishbiomedical.com/exercise/deadlift/',
      'Bent Row': 'https://www.jaquishbiomedical.com/exercise/bent-row/',
      'Bicep Curl': 'https://www.jaquishbiomedical.com/exercise/bicep-curl/',
      'Calf Raise': 'https://www.jaquishbiomedical.com/exercise/calf-raise/'
    }
    return exerciseUrls[exerciseName] || 'https://www.jaquishbiomedical.com/x3-program/'
  }

  const signIn = async () => {
    announceToScreenReader('Redirecting to sign in...')
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if (error) {
      announceToScreenReader('Sign in error. Please try again.', 'assertive')
      console.log('Error:', error)
    }
  }

  const signUpWithEmail = () => {
    router.push('/auth/signup')
  }

  const signInWithEmail = () => {
    router.push('/auth/signin')
  }

  // If user is not authenticated, show splash page
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Hero Banner */}
        <header className="w-full bg-white border-b border-gray-200 p-8 text-center shadow-sm">
          <div className="max-w-6xl mx-auto">
            <h1 className="mb-4 flex justify-center">
              <X3MomentumWordmark size="lg" />
            </h1>
            <h2 className="text-headline-medium mb-2 text-secondary">AI-Powered X3 Resistance Band Tracker</h2>
            <p className="text-body italic text-secondary">Motivation. Progress. Results.</p>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-6xl mx-auto px-4 py-8">
          {/* Feature Grid - Bento Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            {/* AI Coaching Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mr-4">
                  <Sparkles className="w-6 h-6 text-orange-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">AI Coaching</h3>
              </div>
              <p className="text-gray-600 mb-4">Personalized guidance and motivation to keep you on track with your X3 journey.</p>
              <div className="flex items-center text-sm text-orange-600">
                <span>Smart insights</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>

            {/* Progress Analytics Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Progress Analytics</h3>
              </div>
              <p className="text-gray-600 mb-4">Track your strength gains, workout consistency, and personal bests over time.</p>
              <div className="flex items-center text-sm text-blue-600">
                <span>Data-driven insights</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>

            {/* X3 Optimization Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mr-4">
                  <Flame className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">X3 Optimization</h3>
              </div>
              <p className="text-gray-600 mb-4">Specifically designed for X3 resistance bands and Dr. Jaquish's methodology.</p>
              <div className="flex items-center text-sm text-red-600">
                <span>Proven system</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>

            {/* Community Support Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                  <Users className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Community Support</h3>
              </div>
              <p className="text-gray-600 mb-4">Connect with fellow X3 users and share your progress and achievements.</p>
              <div className="flex items-center text-sm text-green-600">
                <span>Join the movement</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>

            {/* Premium Security Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mr-4">
                  <Shield className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Premium Security</h3>
              </div>
              <p className="text-gray-600 mb-4">Enterprise-grade security to protect your personal fitness data and progress.</p>
              <div className="flex items-center text-sm text-purple-600">
                <span>Your data is safe</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>

            {/* Smart Scheduling Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center mb-4">
                <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mr-4">
                  <Calendar className="w-6 h-6 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Smart Scheduling</h3>
              </div>
              <p className="text-gray-600 mb-4">Automated workout scheduling based on the proven X3 program structure.</p>
              <div className="flex items-center text-sm text-indigo-600">
                <span>Never miss a workout</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>
          </div>

          {/* Call to Action Section */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Ready to Transform Your X3 Journey?</h2>
            <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
              Join thousands of X3 users who have eliminated motivation drop-off and achieved consistent results. 
              Start your personalized AI-powered fitness journey today.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button 
                onClick={signInWithEmail}
                className="bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
              >
                Sign In
              </button>
              <button 
                onClick={signUpWithEmail}
                className="bg-white hover:bg-gray-50 text-orange-600 font-semibold py-3 px-8 rounded-lg border-2 border-orange-600 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
              >
                Get Started Free
              </button>
            </div>
            
            <div className="mt-6">
              <button 
                onClick={signIn}
                className="text-gray-500 hover:text-gray-700 text-sm flex items-center justify-center mx-auto"
              >
                <span>Or continue with Google</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!todaysWorkout) {
    return (
      <div className="min-h-screen brand-gradient">
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="card-elevation-2 bg-white rounded-xl p-6 text-center max-w-md mx-4">
            <div className="mb-6">
              <X3MomentumWordmark size="md" className="mx-auto mb-4" />
              <h2 className="text-headline-medium mb-2 text-secondary">Loading...</h2>
            </div>
            <div className="text-body mb-4" role="status" aria-live="polite">
              {user ? 'Loading your workout...' : 'Please sign in to continue'}
            </div>
            {user && (
              <div className="text-body-small text-secondary space-y-1">
                <p>User ID: {user.id}</p>
                <p>Email: {user.email}</p>
                <p>Exercises loaded: {exercises.length}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

 if (todaysWorkout.workoutType === 'Rest') {
  const handleStartExercise = () => router.push('/workout')
  const handleLogWorkout = () => router.push('/workout')
  const handleAddGoal = () => router.push('/goals')
  const handleScheduleWorkout = () => router.push('/calendar')
  const handleViewStats = () => router.push('/stats')

  return (
    <AppLayout 
      onStartExercise={handleStartExercise}
      onLogWorkout={handleLogWorkout}
      onAddGoal={handleAddGoal}
      onScheduleWorkout={handleScheduleWorkout}
      onViewStats={handleViewStats}
      exerciseInProgress={false}
      workoutCompleted={false}
    >
      <div className="container mx-auto px-4 py-8">
        <main>
          <div className="max-w-2xl mx-auto">
            <div className="card-elevation-2 bg-white rounded-xl p-6 text-center">
              <div className="text-6xl mb-6" role="img" aria-label="Rest day relaxation emoji">🛋️</div>
              <h1 className="text-headline-large mb-4 brand-gold">Today&apos;s Rest Day</h1>
              <p className="text-body mb-8">Focus on recovery, hydration, and nutrition</p>
              
              <div className="text-left space-y-3 mb-6">
                <p className="text-body brand-fire font-medium">Recovery Checklist:</p>
                <div className="space-y-2 text-body-small">
                  <div className="flex items-center gap-3">
                    <span>💧</span>
                    <span>Drink 8+ glasses of water</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>🥗</span>
                    <span>Eat protein-rich meals</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>😴</span>
                    <span>Get 7-9 hours of sleep</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>🚶</span>
                    <span>Light walking is beneficial</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>🧘</span>
                    <span>Practice stress management</span>
                  </div>
                </div>
              </div>
              

              <p className="text-body-small text-secondary">Week {todaysWorkout.week} • Day {todaysWorkout.dayInWeek + 1}</p>
              <p className="text-body brand-fire font-medium mt-4">
                Tomorrow: {getTomorrowsWorkout()} Workout Ready! 💪
              </p>



            </div>
          </div>
        </main>
      </div>
    </AppLayout>
  );
}

  // Cadence Button Component
  const CadenceButtonComponent = (
    <div className="w-full flex justify-center">
    <AnimatedCadenceButton cadenceActive={cadenceActive} setCadenceActive={setCadenceActive} />
  </div>
  );

  const handleStartExercise = () => {
    // Navigate to first exercise or start workout flow
    router.push('/workout')
  }

  const handleLogWorkout = () => {
    // Navigate to workout logging
    router.push('/workout')
  }

  const handleAddGoal = () => {
    // Navigate to goals page
    router.push('/goals')
  }

  const handleScheduleWorkout = () => {
    // Navigate to calendar
    router.push('/calendar')
  }

  const handleViewStats = () => {
    // Navigate to stats
    router.push('/stats')
  }


  // Determine current exercise state
  const exerciseInProgress = exercises.some(ex => exerciseStates[Object.keys(exerciseStates).find(key => exerciseStates[parseInt(key)] === 'in_progress') as any] === 'in_progress')
  const workoutCompleted = exercises.length > 0 && exercises.every(ex => ex.saved)

  return (
      <AppLayout 
        onStartExercise={handleStartExercise}
        onLogWorkout={handleLogWorkout}
        onAddGoal={handleAddGoal}
        onScheduleWorkout={handleScheduleWorkout}
        onViewStats={handleViewStats}
        exerciseInProgress={exerciseInProgress}
        workoutCompleted={workoutCompleted}
      >
      <div className="container mx-auto px-6 py-12 max-w-7xl">

        {/* Motivational Greeting */}
        {/* Test Mode Banner */}
        {testModeService.isEnabled() && (
          <div className="bg-purple-100 border-2 border-purple-300 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-center space-x-2">
              <span className="text-2xl">🧪</span>
              <span className="text-purple-800 font-bold text-lg">TEST MODE ACTIVE</span>
            </div>
            <p className="text-purple-700 text-center text-sm mt-2">
              {testModeService.getTestModeIndicator()}
            </p>
            <p className="text-purple-600 text-center text-xs mt-1">
              All features are functional with mock data. TTS uses browser speech synthesis.
            </p>
          </div>
        )}

        <div className="relative overflow-hidden bg-gradient-to-br from-white via-orange-50/50 to-red-50/30 border border-orange-200/50 rounded-3xl spacing-apple-spacious mb-12 shadow-2xl transform hover:scale-[1.02] transition-all duration-500 visual-depth-2 animate-on-load animate-apple-scale-in">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-red-500/5 rounded-3xl"></div>
          <div className="relative z-10 text-center">
            <div className="mb-4">
              <div className="inline-flex items-center space-x-3 bg-white/80 backdrop-blur-sm rounded-full px-6 py-3 shadow-lg">
                <div className="w-3 h-3 bg-gradient-to-r from-orange-500 to-red-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-semibold text-gray-600 uppercase tracking-wider">Week {todaysWorkout?.week || 'Loading'}</span>
              </div>
            </div>
            <h1 className="text-display-medium mb-6 leading-tight bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
              {todaysWorkout?.status === 'catch_up' ? (
                <>Catch up: <span className="bg-gradient-to-r from-orange-500 via-red-500 to-orange-600 bg-clip-text text-transparent font-black">{todaysWorkout?.workoutType || 'Loading'}</span> Workout</>
              ) : (
                <>Today's <span className="bg-gradient-to-r from-orange-500 via-red-500 to-orange-600 bg-clip-text text-transparent font-black">{todaysWorkout?.workoutType || 'Loading'}</span> Workout</>
              )}
            </h1>
            <p className="text-title-large text-gray-700 font-medium italic tracking-wide">"Train to failure, not to a number"</p>
          </div>
        </div>


        {/* TTS Status Indicator */}
        {hasFeature('ttsAudioCues') && (
          <div className="card-elevation-1 bg-apple-card spacing-apple-comfortable text-center mb-8 visual-depth-1 animate-on-load animate-apple-fade-in-up animate-delay-100">
            <div className="flex items-center justify-center space-x-2">
              {ttsLoading && (
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500"></div>
                  <span className="text-orange-600 text-sm font-medium">
                    🔊 Speaking...
                  </span>
                </div>
              )}
              {!ttsLoading && (
                <span className="text-body-small font-medium">
                  {getSourceIndicator()}
                </span>
              )}
            </div>
            {ttsError && (
              <p className="text-body-small text-red-600 mt-1">
                ⚠️ {ttsError}
              </p>
            )}
            {!ttsError && !ttsLoading && (
              <p className="text-body-small text-gray-600 mt-1">
                Audio guidance ready for exercises
              </p>
            )}
          </div>
        )}

        {/* Cadence Control */}
        <div className="card-elevation-1 bg-apple-card spacing-apple-comfortable text-center mb-12 visual-depth-1 animate-on-load animate-apple-fade-in-up animate-delay-200">
          <h3 className="text-title-large mb-4 text-gradient-fire">🎵 Workout Cadence</h3>
          {CadenceButtonComponent}
          <p id="cadence-description" className="text-body-small text-secondary mt-2">
            Audio metronome to help maintain proper exercise timing
          </p>
          
          {/* Start Exercise Button */}
          {exercises.length > 0 && !Object.values(exerciseStates).some(state => state !== 'idle' && state !== 'completed') && (
            <div className="mt-6">
              <button
                onClick={() => startExercise(0)}
                disabled={exerciseLoadingStates[0] || exerciseStates[0] === 'started'}
                className={`btn-apple-style py-3 px-8 rounded-xl font-bold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 ${
                  exerciseLoadingStates[0] || exerciseStates[0] === 'started'
                    ? 'bg-gray-400 text-gray-600 cursor-not-allowed' 
                    : 'bg-green-500 text-white hover:bg-green-600'
                }`}
              >
                {exerciseLoadingStates[0] || exerciseStates[0] === 'started' ? (
                  <>
                    <div className="inline animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Starting Workout...
                  </>
                ) : (
                  <>
                    <Play className="inline mr-2" size={16} aria-hidden="true" />
                    Start Exercise
                  </>
                )}
              </button>
              <p className="text-body-small text-secondary mt-2">
                Begin the full {todaysWorkout.workoutType} workout sequence
              </p>
            </div>
          )}
        </div>

        {/* Rest Timer Display */}
        {restTimer && hasFeature('restTimer') && (
          <div className="card-elevation-1 bg-apple-card spacing-apple-comfortable text-center mb-12 visual-depth-1 animate-on-load animate-apple-fade-in-up animate-delay-300">
            <h3 className="text-title-large mb-4 text-gradient-fire">⏱️ Rest Timer</h3>
            <div className="text-4xl font-bold brand-fire mb-2">
              {Math.floor(restTimer.timeLeft / 60)}:{(restTimer.timeLeft % 60).toString().padStart(2, '0')}
            </div>
            <p className="text-body-small text-secondary mb-3">
              Rest period for {exercises[restTimer.exerciseIndex]?.name}
            </p>
            <button
              onClick={() => setRestTimer(null)}
              className="btn-apple-style btn-secondary"
            >
              Skip Rest
            </button>
            <p className="text-body-small text-secondary mt-2">
              90-second rest period • Premium feature
            </p>
          </div>
        )}

        {/* Exercise Grid */}
        <main>
          <h2 className="sr-only">Exercise tracking cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10 visual-depth-floating animate-on-load animate-apple-fade-in-up animate-delay-400">
            {exercises.map((exercise, index) => (
              <ExerciseCard
                key={exercise.name}
                exercise={exercise}
                index={index}
                exerciseState={exerciseStates[index] || 'idle'}
                isSaveLoading={saveLoadingStates[index] || false}
                saveError={saveErrorStates[index] || null}
                ttsActive={ttsActiveStates[index] || false}
                bandColors={BAND_COLORS}
                onUpdateExercise={updateExercise}
                onSaveExercise={saveExercise}
                onRetrySave={retrySaveExercise}
              />
            ))}
          </div>
        </main>

      </div>
    </AppLayout>
  )
}
