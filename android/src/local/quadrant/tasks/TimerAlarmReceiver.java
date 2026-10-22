package local.quadrant.tasks;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
public class TimerAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){TimerAlarm.fire(context,intent.getLongExtra("deadline",0));}
}
