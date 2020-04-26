using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.SceneManagement;

public class TutorialManager : MonoBehaviour
{
    public GameObject part1;
    public GameObject part2;
    public GameObject part3;
    public GameObject part4;
    public GameObject part5;
    public GameObject part6;

    public void Button1()
    {
        part1.gameObject.SetActive(false);
        part2.gameObject.SetActive(true);
    }
    public void Button2()
    {
        part2.gameObject.SetActive(false);
        part3.gameObject.SetActive(true);
    }
    public void Button3()
    {
        part3.gameObject.SetActive(false);
        part4.gameObject.SetActive(true);
    }
    public void Button4()
    {
        part4.gameObject.SetActive(false);
        part5.gameObject.SetActive(true);
    }
    public void Button5()
    {
        part5.gameObject.SetActive(false);
        part6.gameObject.SetActive(true);
    }
    public void Button6()
    {
        SceneManager.LoadScene("JogoBase");
    }
}
