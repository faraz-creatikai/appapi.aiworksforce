import cron from "node-cron";
import prisma from "../config/prismaClient.js";

const getLocalDateString = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().split("T")[0];
};

const AUTO_CLOCK_OUT_TIME = "19:00";

const [hour, minute] = AUTO_CLOCK_OUT_TIME.split(":");

// Schedule the job to run at 19:00 (7:00 PM) every day.
// We are setting the timezone to 'Asia/Kolkata' to ensure it aligns with IST.
cron.schedule(`${minute} ${hour} * * *`, async () => {
  console.log("🕒 [CRON] Running daily auto clock-out check...");

  try {
    const now = new Date();
    const dateString = getLocalDateString(now);

    // Find all attendance records for today where they clocked in but haven't clocked out
    const missingClockOuts = await prisma.employeeAttendance.findMany({ // 🚨 UPDATED
      where: {
        dateString: dateString,
        clockIn: { not: null },  // They clicked clock in
        clockOut: null           // But forgot to stop it
      }
    });

    if (missingClockOuts.length === 0) {
      console.log("✅ [CRON] All employees clocked out successfully today.");
      return;
    }

    console.log(`⚠️ [CRON] Found ${missingClockOuts.length} employees who forgot to clock out. Fixing...`);

    // Create the 6:30 PM boundary for today
    const endOfDayCap = new Date();
    endOfDayCap.setHours(18, 30, 0, 0);

    // Process all missing records concurrently
    const updates = missingClockOuts.map(async (attendance) => {
      // Calculate total minutes between their clock-in and 6:30 PM
      const diffMs = endOfDayCap.getTime() - attendance.clockIn.getTime();
      
      // If someone somehow clocked in AFTER 6:30 PM, we prevent negative minutes
      const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));

      // Re-evaluate status: If they worked less than 5 hours (300 mins), it's a half day
      let finalStatus = attendance.status;
      if (totalMinutes < 300) {
        finalStatus = "half_day";
      }

      // Update the record
      return prisma.employeeAttendance.update({ // 🚨 UPDATED
        where: { id: attendance.id },
        data: {
          clockOut: endOfDayCap,
          totalMinutes: totalMinutes,
          status: finalStatus,
          isAutoStopped: true, 
          notes: attendance.notes 
            ? attendance.notes + "\n[System]: Auto-clocked out at 6:30 PM." 
            : "[System]: Auto-clocked out at 6:30 PM."
        }
      });
    });

    await Promise.all(updates);
    console.log("✅ [CRON] Successfully auto-clocked out missing employees.");

  } catch (error) {
    console.error("❌ [CRON] Error during auto clock-out:", error.message);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata" 
});