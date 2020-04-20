using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

public class Menu : MonoBehaviour
{
    public AudioSource introMusic;
    void Start()
    {
        introMusic.Play();

    }
    public void PlayGame()
    {
        SceneManager.LoadScene("cenario");
    }

    public void QuitGame()
    {
        Debug.Log("Quit");
        Application.Quit();
    }
}
