using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

public class Credits : MonoBehaviour
{
    private float timer;
    void Start()
    {
        timer = 0;
    }

   
    void Update()
    {
        timer += Time.deltaTime;
        
        if (timer >= 20)
        {
            SceneManager.LoadScene("Menu");
        }
    }
}
