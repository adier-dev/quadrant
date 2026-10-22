package local.quadrant.tasks;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import org.json.JSONObject;

/** One persisted local timer; the receiver and foreground UI share a delivery guard. */
public final class TimerAlarm {
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences("local_timer_alarm",Context.MODE_PRIVATE);}
    static File audio(Context c){return new File(c.getFilesDir(),"timer-audio.bin");}
    static synchronized void setAudio(Context c,String encoded)throws Exception{
        if(encoded.isEmpty()){Files.deleteIfExists(audio(c).toPath());return;}
        byte[] data=Base64.decode(encoded,Base64.DEFAULT);if(data.length>20*1024*1024)throw new Exception("提示音最大 20 MB");
        File temporary=new File(c.getFilesDir(),"timer-audio.tmp");Files.write(temporary.toPath(),data);
        Files.move(temporary.toPath(),audio(c).toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
    }
    private static PendingIntent pending(Context c,long deadline){return PendingIntent.getBroadcast(c,17,new Intent(c,TimerAlarmReceiver.class).putExtra("deadline",deadline),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private static boolean exact(AlarmManager manager){return Build.VERSION.SDK_INT<31||manager.canScheduleExactAlarms();}
    static synchronized JSONObject schedule(Activity c,String status,long deadline,boolean requestPermission)throws Exception{
        AlarmManager manager=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);manager.cancel(pending(c,0));
        if(!status.equals("running")||deadline<=0){prefs(c).edit().putLong("deadline",0).apply();return new JSONObject().put("exact",exact(manager));}
        prefs(c).edit().putLong("deadline",deadline).apply();
        boolean precise=exact(manager);
        if(precise)manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,Math.max(System.currentTimeMillis(),deadline),pending(c,deadline));
        else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,Math.max(System.currentTimeMillis(),deadline),pending(c,deadline));
        if(requestPermission)c.runOnUiThread(()->{
            if(!precise&&Build.VERSION.SDK_INT>=31&&!prefs(c).getBoolean("precision_prompted",false)){
                prefs(c).edit().putBoolean("precision_prompted",true).apply();
                try{c.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+c.getPackageName())));return;}catch(Exception ignored){}
            }
            requestNotificationPermission(c);
        });
        return new JSONObject().put("exact",precise);
    }
    static void reschedule(Activity c){long deadline=prefs(c).getLong("deadline",0);if(deadline>0)try{schedule(c,"running",deadline,false);}catch(Exception ignored){}}
    static void requestNotificationPermission(Activity c){
        if(Build.VERSION.SDK_INT>=33&&prefs(c).getLong("deadline",0)>0&&exact((AlarmManager)c.getSystemService(Context.ALARM_SERVICE))&&!prefs(c).getBoolean("notification_prompted",false)&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            prefs(c).edit().putBoolean("notification_prompted",true).apply();c.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},54);
        }
    }
    static synchronized boolean fire(Context c,long deadline){
        if(deadline<=0||prefs(c).getLong("deadline",0)!=deadline||System.currentTimeMillis()<deadline)return false;
        prefs(c).edit().putLong("deadline",0).commit();
        try{play(c);return true;}catch(Exception e){AlarmAudioService.notifyMissed(c);return false;}
    }
    static void play(Context c){c.startForegroundService(new Intent(c,AlarmAudioService.class));}
}
