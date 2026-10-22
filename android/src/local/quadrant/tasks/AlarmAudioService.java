package local.quadrant.tasks;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.widget.Toast;
import java.io.File;

/** Plays the local file once, even after the WebView is paused or destroyed. */
public class AlarmAudioService extends Service {
    private static final String CHANNEL="quadrant_timer_audio";
    private MediaPlayer player;
    private static void channel(Context c){NotificationManager manager=(NotificationManager)c.getSystemService(NOTIFICATION_SERVICE);NotificationChannel channel=new NotificationChannel(CHANNEL,"到时提示音",NotificationManager.IMPORTANCE_HIGH);channel.setSound(null,null);manager.createNotificationChannel(channel);}
    private static Notification notification(Context c,String text,boolean stop){
        channel(c);PendingIntent open=PendingIntent.getActivity(c,23,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=new Notification.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("象限 · 计时结束").setContentText(text).setContentIntent(open).setCategory(Notification.CATEGORY_ALARM).setOngoing(stop);
        if(stop){PendingIntent action=PendingIntent.getService(c,24,new Intent(c,AlarmAudioService.class).setAction("stop"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);builder.addAction(android.R.drawable.ic_media_pause,"停止提示音",action);}
        return builder.build();
    }
    static void notifyMissed(Context c){try{((NotificationManager)c.getSystemService(NOTIFICATION_SERVICE)).notify(43,notification(c,"计时已结束，请打开应用。允许闹钟权限可改善锁屏提醒。",false));}catch(SecurityException ignored){}}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&"stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        Notification notice=notification(this,"正在播放提示音",true);
        if(Build.VERSION.SDK_INT>=29)startForeground(42,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(42,notice);
        release();playFile(false);return START_NOT_STICKY;
    }
    private void playFile(boolean fallback){
        try{
            player=new MediaPlayer();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());player.setWakeMode(this,PowerManager.PARTIAL_WAKE_LOCK);
            File file=TimerAlarm.audio(this);
            if(!fallback&&file.isFile())player.setDataSource(file.getAbsolutePath());else player.setDataSource(this,RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            player.setOnPreparedListener(p->p.start());player.setOnCompletionListener(p->stopSelf());player.setOnErrorListener((p,what,extra)->{release();if(!fallback){Toast.makeText(this,"音频无法播放，使用系统默认提示音",Toast.LENGTH_LONG).show();playFile(true);}else stopSelf();return true;});player.prepareAsync();
        }catch(Exception e){release();if(!fallback)playFile(true);else stopSelf();}
    }
    private void release(){if(player!=null){try{player.release();}catch(Exception ignored){}player=null;}}
    @Override public void onDestroy(){release();stopForeground(true);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
