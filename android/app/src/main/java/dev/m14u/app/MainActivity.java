package dev.m14u.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(StreamExtractorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
