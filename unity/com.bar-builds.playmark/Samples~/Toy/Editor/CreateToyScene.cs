using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>Tools, Playmark, Create Toy Scene: a camera and the Toy, saved as Assets/PlaymarkToy.unity.</summary>
public static class CreateToyScene
{
    [MenuItem("Tools/Playmark/Create Toy Scene")]
    static void Create()
    {
        if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var cam = new GameObject("Main Camera") { tag = "MainCamera" }.AddComponent<Camera>();
        cam.orthographic = true;
        cam.orthographicSize = 3f;
        cam.transform.position = new Vector3(0, 0, -10);
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color32(0x23, 0x23, 0x3a, 0xff);
        new GameObject("Toy").AddComponent<Toy>();
        EditorSceneManager.SaveScene(scene, "Assets/PlaymarkToy.unity");
        Debug.Log("Playmark: saved Assets/PlaymarkToy.unity. Press Play, then Ctrl+Shift+M.");
    }
}
