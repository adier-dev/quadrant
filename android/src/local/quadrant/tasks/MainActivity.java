package local.quadrant.tasks;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.Build;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Bundled, offline WebView. Network access is limited to a manually discovered LAN peer. */
public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private WebView web;
    private volatile int generation = 0;
    private volatile DatagramSocket discoverySocket;
    private volatile Network peerNetwork;
    private volatile String peerBase;
    private ValueCallback<Uri[]> chooser;
    private String saveKey;
    private byte[] saveBytes;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(246,247,243));
        getWindow().setNavigationBarColor(Color.rgb(246,247,243));
        getWindow().getDecorView().setSystemUiVisibility(0x2000 | 0x10);
        if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(0x2000|0x10|0x100|0x400|0x200);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(246,247,243));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(true);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "QuadrantAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest r) {
                return !r.getUrl().toString().equals(ORIGIN+"/") && !r.getUrl().toString().equals(ORIGIN+"/index.html");
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                try {
                    Uri u = request.getUrl();
                    if (!"https".equals(u.getScheme()) || !"appassets.androidplatform.net".equals(u.getHost())) return blocked();
                    String path=u.getPath();
                    if (path==null || path.equals("/")) path="/index.html";
                    if (!path.matches("/[a-zA-Z0-9_.-]+") || path.contains("..")) return blocked();
                    String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".webmanifest")?"application/manifest+json":"text/html";
                    HashMap<String,String> headers=new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'");
                    headers.put("X-Content-Type-Options","nosniff");
                    headers.put("Cache-Control","no-store");
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(path.substring(1)));
                } catch(Exception e) { return blocked(); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if(chooser!=null) chooser.onReceiveValue(null);
                chooser=callback;
                Intent intent=params.createIntent();intent.putExtra(Intent.EXTRA_LOCAL_ONLY,true);
                try {startActivityForResult(intent,21);} catch(Exception e){chooser.onReceiveValue(null);chooser=null;}
                return true;
            }
        });
        // Place the WebView inside the safe rectangle. WebView padding is not a
        // reliable boundary on edge-to-edge devices and may be consumed twice.
        FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(246,247,243));
        FrameLayout.LayoutParams layout=new FrameLayout.LayoutParams(-1,-1);
        layout.topMargin=(int)(32*getResources().getDisplayMetrics().density);frame.addView(web,layout);setContentView(frame);
        frame.setOnApplyWindowInsetsListener((view,insets)->{
            int left,top,right,bottom;
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());left=safe.left;top=safe.top;right=safe.right;bottom=Math.max(safe.bottom,insets.getInsets(WindowInsets.Type.ime()).bottom);}
            else{left=insets.getSystemWindowInsetLeft();top=insets.getSystemWindowInsetTop();right=insets.getSystemWindowInsetRight();bottom=insets.getSystemWindowInsetBottom();if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){top=Math.max(top,insets.getDisplayCutout().getSafeInsetTop());left=Math.max(left,insets.getDisplayCutout().getSafeInsetLeft());right=Math.max(right,insets.getDisplayCutout().getSafeInsetRight());}}
            FrameLayout.LayoutParams margins=(FrameLayout.LayoutParams)web.getLayoutParams();margins.setMargins(left,top+(int)(8*getResources().getDisplayMetrics().density),right,bottom);web.setLayoutParams(margins);
            return Build.VERSION.SDK_INT>=30?WindowInsets.CONSUMED:insets.consumeSystemWindowInsets();
        });
        frame.requestApplyInsets();
        web.loadUrl(ORIGIN+"/");
    }
    private WebResourceResponse blocked() {return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",new HashMap<>(),new ByteArrayInputStream(new byte[0]));}
    private void result(String key, JSONObject value) {
        runOnUiThread(()->{if(web!=null&&!isDestroyed())web.evaluateJavascript("window.onQuadrantNative("+JSONObject.quote(key)+","+value.toString()+")",null);});
    }
    private void error(String key, String message) {try{result(key,new JSONObject().put("error",message));}catch(Exception ignored){}}
    private byte[] read(InputStream input, int limit) throws Exception {
        if(input==null)throw new Exception("电脑没有返回有效内容");
        try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()) {byte[] chunk=new byte[32768];int n;while((n=in.read(chunk))!=-1){if(out.size()+n>limit)throw new Exception("同步内容超出容量限制");out.write(chunk,0,n);}return out.toByteArray();}
    }
    private class Bridge {
        @JavascriptInterface public void call(String key,String method,String args) {
            executor.execute(()->{
                try {
                    JSONObject options=new JSONObject(args);
                    if(method.equals("discover"))result(key,discover(options));
                    else if(method.equals("request"))result(key,request(options));
                    else if(method.equals("cancel")){generation++;DatagramSocket socket=discoverySocket;if(socket!=null)socket.close();result(key,new JSONObject().put("ok",true));}
                    else if(method.equals("save"))save(key,options);
                    else if(method.equals("set-alarm-audio")){TimerAlarm.setAudio(MainActivity.this,options.optString("data"));result(key,new JSONObject().put("ok",true));}
                    else if(method.equals("schedule-alarm"))result(key,TimerAlarm.schedule(MainActivity.this,options.optString("status"),options.optLong("deadline"),options.optBoolean("request_permission")));
                    else if(method.equals("fire-alarm"))result(key,new JSONObject().put("playing",TimerAlarm.fire(MainActivity.this,options.optLong("deadline"))));
                    else if(method.equals("play-alarm-audio")){TimerAlarm.play(MainActivity.this);result(key,new JSONObject().put("playing",true));}
                    else if(method.equals("stop-alarm-audio")){stopService(new Intent(MainActivity.this,AlarmAudioService.class));result(key,new JSONObject().put("ok",true));}
                    else throw new Exception("本机操作不支持");
                } catch(Exception e){error(key,e.getMessage()==null?"操作失败，请检查局域网连接":e.getMessage());}
            });
        }
    }
    private JSONObject discover(JSONObject options) throws Exception {
        final int current=++generation;
        ConnectivityManager cm=(ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        Network network=null;LinkProperties links=null;
        for(Network n:cm.getAllNetworks()){NetworkCapabilities caps=cm.getNetworkCapabilities(n);LinkProperties p=cm.getLinkProperties(n);if(caps!=null&&p!=null&&(caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)||caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))){network=n;links=p;break;}}
        if(network==null)throw new Exception("未连接局域网。请让手机和电脑连接同一 Wi-Fi 后重试。");
        LinkAddress local=null;
        for(LinkAddress a:links.getLinkAddresses())if(a.getAddress() instanceof Inet4Address&&a.getPrefixLength()>=8&&a.getPrefixLength()<31){local=a;break;}
        if(local==null)throw new Exception("未获取到可用于同步的局域网 IPv4 地址");
        byte[] addr=local.getAddress().getAddress();int address=0;for(byte b:addr)address=(address<<8)|(b&255);
        int mask=-1<<(32-local.getPrefixLength()),broadcast=address|~mask,subnet=address&mask;
        byte[] broadcastBytes=new byte[]{(byte)(broadcast>>>24),(byte)(broadcast>>>16),(byte)(broadcast>>>8),(byte)broadcast};
        String requestId=UUID.randomUUID().toString();
        byte[] payload=new JSONObject().put("protocol","quadrant-lan-v1").put("request_id",requestId).put("desktop_id",options.optString("desktop_id","")).toString().getBytes(StandardCharsets.UTF_8);
        WifiManager wifi=(WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);
        WifiManager.MulticastLock lock=wifi.createMulticastLock("quadrant-manual-sync");lock.acquire();
        DatagramSocket udp=new DatagramSocket();discoverySocket=udp;
        try {
            network.bindSocket(udp);udp.setBroadcast(true);udp.setSoTimeout(1000);
            long end=SystemClock.elapsedRealtime()+120000;
            while(current==generation&&SystemClock.elapsedRealtime()<end) {
                udp.send(new DatagramPacket(payload,payload.length,InetAddress.getByAddress(broadcastBytes),8767));
                byte[] response=new byte[2048];DatagramPacket packet=new DatagramPacket(response,response.length);
                try {
                    udp.receive(packet);byte[] sender=packet.getAddress().getAddress();if(sender.length!=4)continue;
                    int remote=0;for(byte b:sender)remote=(remote<<8)|(b&255);if((remote&mask)!=subnet)continue;
                    JSONObject found=new JSONObject(new String(packet.getData(),0,packet.getLength(),StandardCharsets.UTF_8));
                    if(!found.optString("protocol").equals("quadrant-lan-v1")||!found.optString("request_id").equals(requestId))continue;
                    if(!options.optString("desktop_id","").isEmpty()&&!found.optString("desktop_id").equals(options.optString("desktop_id")))continue;
                    int port=found.optInt("port");if(port<1||port>65535||!found.optString("nonce").matches("[0-9a-f]{32}"))continue;
                    peerNetwork=network;peerBase="http://"+packet.getAddress().getHostAddress()+":"+port;
                    return found;
                } catch(java.net.SocketTimeoutException ignored) {}
            }
            if(current!=generation)throw new Exception("已停止寻找电脑");
            throw new Exception("未发现可同步的电脑。请确认在同一局域网、电脑已按下同步，并允许防火墙的 TCP 服务端口和 UDP 8767；本轮已停止。");
        } finally {udp.close();if(discoverySocket==udp)discoverySocket=null;if(lock.isHeld())lock.release();}
    }
    private JSONObject request(JSONObject options) throws Exception {
        String path=options.optString("path");
        if(!path.matches("/api/lan-sync/peer/(pair|prepare|upload|download|commit|ack)"))throw new Exception("同步请求地址无效");
        String base=peerBase;Network network=peerNetwork;
        if(base==null||network==null)throw new Exception("尚未找到局域网电脑，请重新同步");
        HttpURLConnection connection=(HttpURLConnection)network.openConnection(new URL(base+path));
        try {
            connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(5000);connection.setReadTimeout(60000);connection.setRequestMethod("POST");connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            connection.setRequestProperty("X-Quadrant-Device",options.optString("device"));connection.setRequestProperty("X-Quadrant-Signature",options.optString("signature"));
            byte[] body=options.optString("body").getBytes(StandardCharsets.UTF_8);if(body.length>64*1024*1024)throw new Exception("单次同步内容不能超过 64 MB");connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream out=connection.getOutputStream()){out.write(body);}
            int code=connection.getResponseCode();JSONObject response=new JSONObject(new String(read(code>=400?connection.getErrorStream():connection.getInputStream(),64*1024*1024),StandardCharsets.UTF_8));
            if(code<200||code>=300)throw new Exception(response.optString("error","连接被拒绝，请重新同步"));
            return response;
        } catch(java.io.IOException e){throw new Exception("局域网连接中断或电脑不可达，已停止本轮同步。请检查同一 Wi-Fi 与防火墙。");}
        finally {connection.disconnect();}
    }
    private void save(String key,JSONObject options) throws Exception {
        byte[] bytes=Base64.decode(options.getString("data"),Base64.DEFAULT);
        runOnUiThread(()->{
            if(saveKey!=null){error(key,"请先完成当前文件保存");return;}
            saveKey=key;saveBytes=bytes;
            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(options.optString("mime","application/octet-stream"));intent.putExtra(Intent.EXTRA_TITLE,options.optString("name","quadrant-backup.zip"));intent.putExtra(Intent.EXTRA_LOCAL_ONLY,true);
            try{startActivityForResult(intent,22);}catch(Exception e){saveKey=null;saveBytes=null;error(key,"无法打开本机文件保存界面");}
        });
    }
    @Override protected void onActivityResult(int code,int status,Intent data) {
        super.onActivityResult(code,status,data);
        if(code==21&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(status,data));chooser=null;}
        if(code==22&&saveKey!=null){final String key=saveKey;final byte[] bytes=saveBytes;saveKey=null;saveBytes=null;
            if(status!=RESULT_OK||data==null||data.getData()==null){error(key,"已取消文件保存");return;}
            Uri uri=data.getData();executor.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(uri)){out.write(bytes);result(key,new JSONObject().put("ok",true));}catch(Exception e){error(key,"文件保存失败，请检查手机存储空间");}});
        }
    }
    @Override public void onBackPressed(){web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){if(d.dispatchEvent(new Event('cancel',{cancelable:true})))d.close();return;}if(typeof navigate==='function')navigate('board');})()",null);}
    @Override protected void onResume(){super.onResume();TimerAlarm.reschedule(this);TimerAlarm.requestNotificationPermission(this);}
    @Override protected void onDestroy(){generation++;if(discoverySocket!=null)discoverySocket.close();if(web!=null){web.removeJavascriptInterface("QuadrantAndroid");web.destroy();web=null;}executor.shutdownNow();super.onDestroy();}
}
