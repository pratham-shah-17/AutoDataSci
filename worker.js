importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js");

let pyodide;
let isReady = false;

// We will use a lightweight Python script string for our autonomous logic
const PYTHON_BACKEND = `
import pandas as pd
import numpy as np
import io
import json
import traceback

# Store dataset globally in memory
global_df = None

def load_and_profile(csv_string):
    global global_df
    try:
        global_df = pd.read_csv(io.StringIO(csv_string))
        
        # Calculate summary statistics
        desc = global_df.describe(include='all').to_dict()
        missing = global_df.isnull().sum().to_dict()
        
        # Simple profiling text
        cols = list(global_df.columns)
        num_cols = global_df.select_dtypes(include=[np.number]).columns.tolist()
        cat_cols = global_df.select_dtypes(exclude=[np.number]).columns.tolist()
        
        summary = f"Dataset loaded successfully with {len(global_df)} rows and {len(cols)} columns.\\n\\n"
        summary += f"Numerical features: {', '.join(num_cols)}\\n"
        summary += f"Categorical features: {', '.join(cat_cols)}\\n\\n"
        summary += "Missing values identified:\\n"
        for k, v in missing.items():
            if v > 0:
                summary += f"- {k}: {v} missing\\n"
                
        # Handle simple imputation automatically
        for c in num_cols:
            if global_df[c].isnull().any():
                global_df[c].fillna(global_df[c].median(), inplace=True)
        for c in cat_cols:
            if global_df[c].isnull().any():
                global_df[c].fillna(global_df[c].mode()[0], inplace=True)
                
        summary += "\\nData cleaned: Missing values automatically imputed (median for numerical, mode for categorical)."
        
        # Try to create a basic plot (e.g. correlation matrix if enough numeric cols)
        plot_json = None
        if len(num_cols) >= 2:
            corr = global_df[num_cols].corr()
            import plotly.graph_objects as go
            fig = go.Figure(data=go.Heatmap(
                z=corr.values,
                x=corr.columns,
                y=corr.columns,
                colorscale='Viridis'
            ))
            fig.update_layout(title="Correlation Matrix", margin=dict(l=20, r=20, t=40, b=20))
            plot_json = fig.to_json()
            
        return json.dumps({
            "rows": len(global_df),
            "cols": len(cols),
            "summary": summary,
            "plot": plot_json
        })
    except Exception as e:
        return json.dumps({"error": str(traceback.format_exc())})

def handle_agent_request(prompt):
    global global_df
    if global_df is None:
        return json.dumps({"error": "No data loaded."})
        
    prompt = prompt.lower()
    
    # Heuristics to simulate the Agent mapping NLP to tasks
    try:
        if "churn" in prompt or "predict" in prompt or "model" in prompt or "train" in prompt:
            # Try to find a target column
            cols = list(global_df.columns)
            target = None
            for c in cols:
                if c.lower() in ["churn", "target", "label", "class", "y", "predict"]:
                    target = c
                    break
                    
            if not target:
                # Default to last categorical or binary column
                cat_cols = global_df.select_dtypes(exclude=[np.number]).columns.tolist()
                target = cat_cols[-1] if cat_cols else cols[-1]
                
            from sklearn.model_selection import train_test_split
            from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
            from sklearn.preprocessing import LabelEncoder
            from sklearn.metrics import accuracy_score, mean_squared_error, r2_score
            import plotly.express as px
            import plotly.graph_objects as go
            
            df_proc = global_df.copy()
            
            # Encode target if necessary
            le = LabelEncoder()
            is_classification = False
            if df_proc[target].dtype == 'object' or df_proc[target].nunique() < 10:
                df_proc[target] = le.fit_transform(df_proc[target].astype(str))
                is_classification = True
                
            # Dummy encode categorical features
            df_proc = pd.get_dummies(df_proc, drop_first=True)
            
            X = df_proc.drop(columns=[target])
            y = df_proc[target]
            
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            if is_classification:
                model = RandomForestClassifier(n_estimators=50, random_state=42)
                model.fit(X_train, y_train)
                preds = model.predict(X_test)
                acc = accuracy_score(y_test, preds)
                metric_text = f"Accuracy: {acc:.2%}"
            else:
                model = RandomForestRegressor(n_estimators=50, random_state=42)
                model.fit(X_train, y_train)
                preds = model.predict(X_test)
                r2 = r2_score(y_test, preds)
                metric_text = f"R² Score: {r2:.3f}"
                
            # Feature Importance Plot
            importances = model.feature_importances_
            indices = np.argsort(importances)[::-1][:10] # Top 10
            
            fig = px.bar(
                x=importances[indices], 
                y=[X.columns[i] for i in indices], 
                orientation='h',
                title=f"Top Predictors for '{target}'"
            )
            fig.update_layout(yaxis={'categoryorder':'total ascending'})
            
            insights = f"Trained a Random Forest {'Classifier' if is_classification else 'Regressor'} to predict '{target}'.\\n"
            insights += f"Model Performance - {metric_text}\\n\\n"
            insights += "The chart shows the top features contributing to the model's decisions."
            
            return json.dumps({
                "text": f"I have trained a Random Forest model on '{target}'. The {metric_text.lower()}. Check the visualizations for feature importance.",
                "insights": insights,
                "plot": fig.to_json()
            })
            
        elif "segment" in prompt or "cluster" in prompt:
            from sklearn.cluster import KMeans
            from sklearn.preprocessing import StandardScaler
            import plotly.express as px
            from sklearn.decomposition import PCA
            
            num_df = global_df.select_dtypes(include=[np.number]).dropna(axis=1)
            scaler = StandardScaler()
            scaled = scaler.fit_transform(num_df)
            
            kmeans = KMeans(n_clusters=3, random_state=42)
            clusters = kmeans.fit_predict(scaled)
            
            # PCA for 2D visualization
            pca = PCA(n_components=2)
            pca_res = pca.fit_transform(scaled)
            
            fig = px.scatter(
                x=pca_res[:,0], 
                y=pca_res[:,1], 
                color=clusters.astype(str),
                title="K-Means Customer Segmentation (PCA reduced)",
                labels={'x': 'PCA 1', 'y': 'PCA 2', 'color': 'Cluster'}
            )
            
            insights = f"Segmented the data into 3 clusters using K-Means.\\n\\n"
            for i in range(3):
                cluster_size = (clusters == i).sum()
                insights += f"- Cluster {i}: {cluster_size} records\\n"
                
            return json.dumps({
                "text": "I performed a K-Means clustering (K=3) to segment your data. I've plotted the 2D PCA projection of the clusters.",
                "insights": insights,
                "plot": fig.to_json()
            })
            
        else:
            return json.dumps({
                "text": "I can help you predict a target variable (e.g., 'predict churn') or segment the data (e.g., 'cluster data'). Please try one of those commands!",
                "insights": "Please ask a specific analytical question.",
                "plot": None
            })
            
    except Exception as e:
        return json.dumps({"error": str(traceback.format_exc())})
`;

async function initEngine() {
    try {
        postMessage({ type: 'INIT_STATUS', data: { message: 'Downloading Pyodide...', status: 'loading' }});
        pyodide = await loadPyodide();
        
        postMessage({ type: 'INIT_STATUS', data: { message: 'Loading Python Packages (Pandas, Scikit-Learn)...', status: 'loading' }});
        await pyodide.loadPackage(['pandas', 'scikit-learn']);
        
        // Load micropip to install plotly
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport("micropip");
        await micropip.install('plotly');
        
        // Execute the backend Python script to define our functions
        await pyodide.runPythonAsync(PYTHON_BACKEND);
        
        isReady = true;
        postMessage({ type: 'INIT_STATUS', data: { message: 'Engine Ready', status: 'ready' }});
    } catch (error) {
        console.error("Initialization error:", error);
        postMessage({ type: 'INIT_STATUS', error: "Failed to initialize: " + error.message });
    }
}

// Handle incoming messages
onmessage = async function(e) {
    const { type, data } = e.data;
    
    if (type === 'PROCESS_CSV') {
        if (!isReady) return;
        try {
            // Escape newlines in CSV for python string injection
            const loadProfileFunc = pyodide.globals.get('load_and_profile');
            const resultJson = loadProfileFunc(data);
            const result = JSON.parse(resultJson);
            
            if (result.error) throw new Error(result.error);
            
            postMessage({ type: 'DATA_PROFILED', data: result });
        } catch (error) {
            postMessage({ type: 'DATA_PROFILED', error: error.message });
        }
    } 
    else if (type === 'CHAT_REQUEST') {
        if (!isReady) return;
        try {
            const handleAgentFunc = pyodide.globals.get('handle_agent_request');
            const resultJson = handleAgentFunc(data);
            const result = JSON.parse(resultJson);
            
            if (result.error) throw new Error(result.error);
            
            postMessage({ type: 'CHAT_RESPONSE', data: result });
        } catch (error) {
            postMessage({ type: 'CHAT_RESPONSE', error: error.message });
        }
    }
};

// Start initialization
initEngine();
